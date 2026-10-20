import * as fs from "node:fs";
import * as path from "node:path";

import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { mark } from "../../../../base/common/performance.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { decodeBufferByBOM, DEFAULT_ENCODING, getEncodingInfo } from "../../../../editor/common/model/encoding.ts";
import {
    decodeStream,
    decodeStreamByBOM,
    encodeChunks,
    type IDecodedStream,
} from "../../../../editor/common/model/encodingStream.ts";
import { createTextBufferFactoryFromChunks } from "../../../../editor/common/model/textDocument.ts";
import {
    etag,
    FileOperationResult,
    type IFileService,
    type IFileStat,
    isFileOperationError,
} from "../../../../platform/files/common/files.ts";
import type { IFileWatcher } from "../../../../platform/files/common/iFileWatcher.ts";
import type { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { BaseTextEditorModel } from "../../../common/editor/textEditorModel.ts";

import type { TextFileSaveParticipant } from "./textFileSaveParticipant.ts";

/**
 * Итог сохранения. `conflict` — файл на диске изменился внешним процессом с
 * момента открытия/последней записи, и запись отменена (чтобы не затереть
 * параллельные правки); повторить с `{ overwrite: true }`.
 */
export type SaveOutcome = "saved" | "conflict" | "no-file";

/** Снимок метаданных файла на диске для детекта внешних изменений (mtime + размер). */
interface IDiskStat {
    mtimeMs: number;
    size: number;
}

/** etag снимка в форме файлового сервиса (см. {@link etag}): гард записи. */
function diskEtag(stat: IDiskStat): string {
    return etag({ mtime: stat.mtimeMs, size: stat.size });
}

/**
 * Ресурс свежесозданной модели: безымянный буфер без номера. Номер назначает группа
 * ({@link TextFileModel.setUntitled}) — она владеет счётчиком; до этого модель ещё
 * никто не видит.
 */
const UNTITLED_PLACEHOLDER_URI = Uri.from({ scheme: "untitled", path: "Untitled" });

/**
 * Пауза перед перепроверкой пропавшего файла (эталон: `TextFileEditorModel.onDidFilesChange`,
 * те же 100 мс). Атомарная запись чужим редактором — удаление и тут же новый файл;
 * если через паузу файл на месте, это была запись, а не удаление.
 */
export const ORPHAN_CHECK_DELAY_MS = 100;

/**
 * Per-file модель текстового файла без view (аналог `ITextFileEditorModel` VS Code):
 * поверх буфера ({@link BaseTextEditorModel}: документ, язык, EOL, история) — ось
 * кодировки, dirty-статус против диска, запись на диск (save/saveAs + save-участник)
 * и слежение за файлом (авто-перечитка чистого буфера / флаг конфликта у
 * «грязного»). Файл с диска, ресурс пишущего провайдера ФС расширения
 * ({@link openProvided}) либо безымянный буфер; синтетика (Output, виртуальные
 * документы, снимки) — `SyntheticTextModel`. Не singleton-сервис: экземпляр на
 * файл, создаёт владелец (`EditorService`).
 */
export class TextFileModel extends BaseTextEditorModel {
    /**
     * Кодировка байтового представления на диске (id из SUPPORTED_ENCODINGS).
     * В отличие от EOL это состояние модели, а не документа: документ видит
     * только строки, а кодировка применяется на дисковой границе (read/write).
     * Не undoable и не входит в isModified — Reopen заменяет документ целиком,
     * Save with Encoding сохраняет сразу (как в VS Code).
     */
    private encodingValue: string = DEFAULT_ENCODING;
    private readonly onDidChangeEncodingEmitter = this.register(new Emitter<void>());
    /**
     * Метаданные файла на момент последнего чтения/записи. Сверяя их с текущим
     * stat, мы отличаем внешнее изменение файла от собственной записи и от
     * «файл не трогали». `null` — файла не было на диске при открытии.
     */
    private diskStat: IDiskStat | null = null;
    private diskConflictValue = false;
    private readonly onDidChangeDiskStateEmitter = this.register(new Emitter<void>());
    private fileWatch: IDisposable | null = null;
    /** Файл удалён с диска, а модель жива (`TextFileEditorModelState.ORPHAN` эталона). */
    private orphanedValue = false;
    private readonly onDidChangeOrphanedEmitter = this.register(new Emitter<void>());
    /** Отложенная перепроверка пропавшего файла ({@link ORPHAN_CHECK_DELAY_MS}). */
    private orphanCheck: ReturnType<typeof setTimeout> | null = null;
    /** Номер последней перечитки с диска: асинхронный reopen сверяет его, прежде чем писать в документ. */
    private loadGeneration = 0;
    /** Подписка на изменения ресурса провайдера ({@link openProvided}). */
    private providedWatch: IDisposable | null = null;

    /** Кодировка, в которой документ читается с диска и пишется на диск. */
    public get encoding(): string {
        return this.encodingValue;
    }

    /**
     * Меняет кодировку, в которой документ будет записан на диск. Неизвестные
     * id игнорируются (пикеры оперируют только элементами SUPPORTED_ENCODINGS).
     * Содержимое буфера не трогает — перечитывание с диска делает
     * {@link reopenWithEncoding}.
     */
    public setEncoding(encoding: string): void {
        if (getEncodingInfo(encoding) === undefined) return;
        this.applyEncoding(encoding);
    }

    private applyEncoding(encoding: string): void {
        if (this.encodingValue === encoding) return;
        this.encodingValue = encoding;
        this.onDidChangeEncodingEmitter.fire();
    }

    private readonly onDidSaveDocumentEmitter = this.register(new Emitter<void>());

    /**
     * Событие «документ записан на диск» (save/saveAs). Первым подписан
     * владелец-сервис (перепривязка реестра моделей), дальше — вкладки: сохранение меняет вид вкладки (гаснет маркер
     * изменённости, после saveAs меняется имя) — у каждой из N вкладок
     * документа.
     */
    public readonly onDidSaveDocument = this.onDidSaveDocumentEmitter.event;

    private fireSaved(): void {
        this.onDidSaveDocumentEmitter.fire();
    }

    /**
     * Наблюдатель за файлами (инъектируется группой перед openFile). Когда задан,
     * модель следит за открытым файлом и реагирует на внешние изменения
     * (авто-перечитка чистого буфера, флаг конфликта для «грязного»). По
     * умолчанию `null` — без live-watch (юнит-тесты, если фейк не подставлен).
     */
    public fileWatcher: IFileWatcher | null = null;

    /**
     * Пайплайн save-участников, общий для всех моделей владельца
     * (`EditorService`); модель прогоняет его перед записью — и в `save`, и в
     * `saveAs`. Не задан ⇒ участников нет.
     */
    public saveParticipant: TextFileSaveParticipant | null = null;

    /**
     * `true`, если файл изменился на диске внешним процессом, а в буфере есть
     * несохранённые правки (авто-перечитать нельзя — затрём пользователя). При
     * следующем сохранении это приведёт к диалогу подтверждения перезаписи.
     */
    public get hasDiskConflict(): boolean {
        return this.diskConflictValue;
    }

    /**
     * Событие смены «дискового» состояния модели: файл перечитан с диска
     * (чистый буфер) либо взведён/снят флаг конфликта. Подписка живёт на
     * модели и переживает пересоздание документа в openFile.
     */
    public readonly onDidChangeDiskState = this.onDidChangeDiskStateEmitter.event;

    /**
     * Файл модели удалён с диска (orphaned): вкладка зачёркнута, текст буфера
     * жив, сохранение пересоздаст файл. Снимается, когда файл вернулся
     * (восстановили, записали снаружи) и после сохранения. Безымянный буфер и
     * файл, которого не было уже при открытии, orphaned не бывают.
     */
    public get isOrphaned(): boolean {
        return this.orphanedValue;
    }

    /**
     * Смена {@link isOrphaned}. Вкладки видят её и через {@link onDidChangeDiskState}
     * (файрится следом); отдельное событие — для тех, кому нужен именно факт удаления
     * (`workbench.editor.closeOnFileDelete`).
     */
    public readonly onDidChangeOrphaned = this.onDidChangeOrphanedEmitter.event;

    /**
     * Событие смены кодировки (setEncoding, reopenWithEncoding или детект при
     * открытии другого файла). Подписка живёт на модели.
     */
    public readonly onDidChangeEncoding = this.onDidChangeEncodingEmitter.event;

    /**
     * Путь ресурса на диске или `null`, если его там нет (безымянный буфер).
     *
     * Гейт по схеме, а не по «`fsPath` непустой»: `fsPath` у не-file схемы не бросает,
     * а отдаёт путь как есть (`untitled:Untitled-1` → `"Untitled-1"`), и такой «путь»
     * ушёл бы в `node:fs` как относительный.
     */
    private get filePath(): string | null {
        return this.uriValue.scheme === "file" ? this.uriValue.fsPath : null;
    }

    public get fileName(): string | null {
        const filePath = this.filePath;
        return filePath === null ? null : path.basename(filePath);
    }

    public get absoluteFilePath(): string | null {
        return this.filePath;
    }

    /**
     * Свежая модель — безымянный буфер без номера (`untitled:Untitled`): номер
     * назначает группа ({@link setUntitled}), файл — {@link openFile}. Не `null`:
     * ветку «пути нет» задаёт схема, а не отсутствие значения.
     * @param files Запись на диск (save / saveAs) — через файловый сервис:
     * атомарно, с гардом по etag и очередью записи на ресурс. Чтение пока
     * синхронное, мимо сервиса (docs/TODO/FileService.md, PR 5).
     */
    public constructor(
        languageService: ILanguageService,
        undoRedoService: UndoRedoService,
        private readonly files: IFileService,
    ) {
        super(languageService, undoRedoService, UNTITLED_PLACEHOLDER_URI);
        this.register({
            dispose: () => {
                // Незавершённый reopen не пишет в закрытую модель.
                // Stryker disable next-line UpdateOperator: см. readDiskBytes
                this.loadGeneration++;
                this.fileWatch?.dispose();
                this.providedWatch?.dispose();
                this.cancelOrphanCheck();
            },
        });
    }

    /** У файла шаг истории касается его пути; у безымянного буфера — ничего. */
    protected override get undoResources(): string[] {
        const filePath = this.filePath;
        return filePath === null ? [] : [filePath];
    }

    /**
     * Присваивает буферу номер безымянного (`untitled:Untitled-N`). Номерами владеет
     * группа: счётчик общий на группу, а вызывать это надо до того, как редактор
     * попадёт в список вкладок и станет кому-то виден.
     */
    public setUntitled(untitledNumber: number): void {
        this.uriValue = Uri.from({ scheme: "untitled", path: `Untitled-${untitledNumber}` });
    }

    /**
     * Открывает файл с диска. Принимает уже поднятый `file:`-uri: подъём (и `path.resolve`
     * относительных путей из CLI/дерева) делает группа — единственная точка, где строка
     * становится ресурсом. `Uri.file` относительный путь НЕ резолвит, поэтому резолвить
     * после подъёма было бы поздно.
     */
    public openFile(uri: Uri): void {
        // Гейт по схеме: `fsPath` у не-file uri не бросает, а отдаёт путь как
        // есть — без гейта `git:`-ресурс молча показал бы рабочее дерево и
        // повесил watcher на чужой путь. Не-file буферы — `openSynthetic`.
        if (uri.scheme !== "file") {
            throw new Error(`TextFileModel.openFile: ожидается file:-uri, получен ${uri.scheme}:`);
        }
        this.uriValue = uri;
        const filePath = uri.fsPath;
        this.loadDocumentFromDisk(filePath);
        this.adoptWorkspaceUndo(filePath, path.basename(filePath));
        this.startWatchingFile(filePath);
    }

    /**
     * Ресурс провайдера ФС расширения (`_claude_fs_right:` у Claude Code) —
     * как файл в эталоне (`TextFileEditorModel` поверх `IFileService` любой
     * схемы): правится, сохраняется записью провайдера через файловый сервис
     * (с save-участниками), чистый буфер перечитывается по `onDidChangeFile`.
     * Байты читает вызывающий (чтение провайдера асинхронное, а модель
     * рождается в реестре синхронно); кодировка — сниф BOM, иначе utf-8.
     */
    public openProvided(uri: Uri, bytes: Uint8Array): void {
        if (uri.scheme === "file" || uri.scheme === "untitled") {
            throw new Error(`TextFileModel.openProvided: ожидается ресурс провайдера, получен ${uri.scheme}:`);
        }
        this.uriValue = uri;
        this.applyProvided(bytes);
        this.providedWatch = this.files.onDidFilesChange((uris) => {
            if (uris.some((changed) => changed.toString() === uri.toString())) void this.reloadProvided();
        });
    }

    /** Ресурс провайдера ФС ({@link openProvided}): не диск и не безымянный буфер. */
    private get isProvided(): boolean {
        return this.providedWatch !== null;
    }

    private applyProvided(bytes: Uint8Array): void {
        const { text, encoding } = decodeBufferByBOM(Buffer.from(bytes));
        this.applyEncoding(encoding);
        this.replaceText(text);
        this.doc.setLanguage(this.resolveLanguageId(this.uriValue.path));
    }

    /**
     * Провайдер сообщил об изменении ресурса. Своя же запись (сохранение)
     * тоже приходит событием — её отличаем по тексту: тот же текст не
     * перечитываем, иначе сохранение стирало бы историю отмены. «Грязный»
     * буфер не трогаем — взводим конфликт, как у файла.
     */
    private async reloadProvided(): Promise<void> {
        // Stryker disable next-line UpdateOperator: см. readDiskBytes
        const generation = ++this.loadGeneration;
        let bytes: Uint8Array;
        try {
            bytes = (await this.files.readFile(this.uriValue)).value;
        } catch {
            return;
        }
        if (generation !== this.loadGeneration) return;
        if (decodeBufferByBOM(Buffer.from(bytes)).text === this.doc.serialize()) return;
        if (this.isModified) {
            this.setDiskConflict(true);
            return;
        }
        this.applyProvided(bytes);
        this.fireDiskStateChange();
    }

    /**
     * Читает файл с диска в документ модели ({@link replaceText}: история
     * отмены сбрасывается, view ремапит каретку и скролл как при любой правке).
     * Общий путь для {@link openFile} и {@link revertToDisk}. Кодировка — сниф BOM, иначе utf-8
     * (revert пере-детектит, как reload в VS Code): такой декод синхронный и без
     * iconv. Явная кодировка — {@link reopenWithEncoding}.
     */
    private loadDocumentFromDisk(filePath: string): void {
        this.applyDecoded(filePath, decodeStreamByBOM(this.readDiskChunks(filePath)));
    }

    /**
     * Байты файла для перечитки — кусками по мере прохода, без буфера всего
     * файла; каждая перечитка начинает новое поколение загрузки. Нет файла —
     * ни одного куска.
     */
    private readDiskChunks(filePath: string): Iterable<Buffer> {
        // Stryker disable next-line UpdateOperator: поколение сверяется только на равенство — «--» тоже новое значение
        this.loadGeneration++;
        return readFileChunks(filePath);
    }

    /**
     * Кладёт декодированный файл в документ: буфер собирается прямо из кусков
     * декодера (A4, docs/TODO/VscodeModel.md) — строки всего файла не бывает.
     * Обновляет снимок `diskStat` и снимает флаг конфликта.
     */
    private applyDecoded(filePath: string, { text, encoding }: IDecodedStream): void {
        let chars = 0;
        const factory = createTextBufferFactoryFromChunks(
            (function* () {
                for (const chunk of text) {
                    chars += chunk.length;
                    yield chunk;
                }
            })(),
        );
        // Вехи лестницы старта (docs/TODO/OpenPerformance.md): без трассы — no-op.
        // Чтение и декод идут одним проходом по кускам, «декодирован» — буфер
        // из кусков собран.
        mark("textfile:decoded", { chars });
        this.applyEncoding(encoding);
        this.diskStat = this.readDiskStat(filePath);
        this.diskConflictValue = false;
        // Файл прочитан с диска — он есть (вернулся, а watcher промолчал).
        // Пропавший файл перечитка не воскрешает: байтов нет, флаг остаётся.
        if (this.diskStat !== null) this.setOrphaned(false);
        this.replaceText(factory);
        mark("textfile:document-built", { lines: this.doc.lineCount });
        // Язык — после текста: у перечитки того же файла он прежний (no-op), а
        // у первого открытия смена языка пересаживает токенизатор уже готовым
        // вью — на документ с текстом, а не на пустой.
        this.doc.setLanguage(this.resolveLanguageId(filePath));
    }

    public async save(options?: { overwrite?: boolean }): Promise<SaveOutcome> {
        const filePath = this.filePath;
        if (filePath === null && !this.isProvided) return "no-file";
        // Защита от затирания параллельных правок: если файл на диске изменился
        // внешним процессом с момента открытия/последней записи — не пишем, а
        // сообщаем о конфликте. Повторный вызов с overwrite: true форсит запись.
        // У ресурса провайдера снимка нет: его конфликт взводит перечитка.
        // Stryker disable next-line ConditionalExpression: эквивалентный — без файла `diskStat` пуст, и stat «нет файла» от него не отличается
        if (options?.overwrite !== true && filePath !== null && this.hasExternalChange(filePath)) {
            this.setDiskConflict(true);
            return "conflict";
        }
        const participation = this.saveParticipant?.participate(this) ?? null;
        if (participation !== null) await participation;
        let written: IFileStat;
        try {
            const bytes = await encodeChunks(this.doc.createSnapshot(), this.encodingValue);
            written = await this.files.writeFile(this.uriValue, bytes, {
                atomic: true,
                // Тот же гард, что выше, но в момент записи: пока работали
                // участники, файл мог измениться снаружи.
                etag: options?.overwrite === true || this.diskStat === null ? undefined : diskEtag(this.diskStat),
            });
        } catch (e) {
            if (!isFileOperationError(e, FileOperationResult.ModifiedSince)) throw e;
            this.setDiskConflict(true);
            return "conflict";
        }
        if (filePath !== null) this.diskStat = { mtimeMs: written.mtime, size: written.size };
        this.markSaved();
        this.setDiskConflict(false);
        // Сохранение пересоздало удалённый файл.
        this.setOrphaned(false);
        this.fireSaved();
        return "saved";
    }

    /**
     * Меняет кодировку и сразу сохраняет («Save with Encoding»). Для буфера без
     * файла на диске возвращает "no-file" — вызывающий уводит в Save As
     * (кодировка при этом уже выставлена).
     */
    public async saveWithEncoding(encoding: string, options?: { overwrite?: boolean }): Promise<SaveOutcome> {
        this.setEncoding(encoding);
        return this.save(options);
    }

    /**
     * Перечитывает файл с диска, отбрасывая несохранённые правки (аналог
     * `Revert File` в VS Code). Используется авто-перечиткой чистого буфера при
     * внешнем изменении и вручную. Возвращает `false`, если файла нет.
     */
    public revertToDisk(): boolean {
        if (this.filePath === null) return false;
        this.loadDocumentFromDisk(this.filePath);
        return true;
    }

    /**
     * Несохранённые правки, переехавшие сюда за перенесённым файлом (rename/move
     * в проводнике при «грязной» вкладке). Модель только что прочитала файл по
     * новому пути — текст буфера встаёт поверх целиком, и модель остаётся
     * изменённой против диска. Аналог `resolve({ contents })` у
     * `TextFileEditorModelManager` эталона на операции MOVE: история отмены у
     * новой модели своя, с нуля.
     */
    public restoreUnsavedContents(text: string): void {
        this.replaceText(text, { unsaved: true });
    }

    /**
     * Перечитывает файл с диска в указанной кодировке («Reopen with Encoding»),
     * отбрасывая несохранённые правки — подтверждение у «грязного» буфера
     * спрашивает вызывающий. Возвращает `false` для буфера без файла на диске и
     * для перечитки, которую обогнала другая (декод не-Unicode кодировки
     * асинхронный — ждёт iconv).
     */
    public async reopenWithEncoding(encoding: string): Promise<boolean> {
        const filePath = this.filePath;
        if (filePath === null) return false;
        const chunks = this.readDiskChunks(filePath);
        const generation = this.loadGeneration;
        const decoded = await decodeStream(chunks, encoding);
        // Декодер мог ждать iconv: за это время буфер перечитали (revert, новый
        // reopen), перепривязали к другому пути или закрыли — результат устарел.
        // Начатое чтение дочитывается и устаревшим: проход закрывает файл.
        if (generation !== this.loadGeneration || filePath !== this.filePath) {
            Array.from(decoded.text);
            return false;
        }
        this.applyDecoded(filePath, decoded);
        return true;
    }

    /**
     * Writes the document to a new path and re-points the model to it.
     *
     * Unlike {@link openFile}, the document/view-state/undo-history/cursor are
     * preserved — the undo bucket is keyed by {@link undoContext}, which is tied to
     * the editor rather than to its path, so re-pointing does not strand the history
     * accumulated before the save. The language is re-resolved for the new extension;
     * the bound language listener re-tokenizes and repaints automatically. Firing
     * `onDidSave` lets the group controller rename the tab and clear the dirty
     * marker.
     */
    public async saveAs(newPath: string): Promise<void> {
        // Смена идентичности на месте: у безымянного буфера это переход untitled: → file:,
        // у ресурса провайдера — уход на диск (слежение за провайдером снимается).
        this.uriValue = Uri.file(path.resolve(newPath));
        this.providedWatch?.dispose();
        this.providedWatch = null;
        const participation = this.saveParticipant?.participate(this) ?? null;
        if (participation !== null) await participation;
        const bytes = await encodeChunks(this.doc.createSnapshot(), this.encodingValue);
        const written = await this.files.writeFile(this.uriValue, bytes, { atomic: true });
        this.diskStat = { mtimeMs: written.mtime, size: written.size };
        this.doc.setLanguage(this.resolveLanguageId(newPath));
        this.markSaved();
        this.setDiskConflict(false);
        this.setOrphaned(false);
        this.startWatchingFile(newPath);
        this.fireSaved();
    }

    /** Читает stat файла (mtime + размер) или `null`, если файла нет/недоступен. */
    private readDiskStat(filePath: string): IDiskStat | null {
        try {
            const stat = fs.statSync(filePath);
            return { mtimeMs: stat.mtimeMs, size: stat.size };
        } catch {
            return null;
        }
    }

    /**
     * Изменился ли файл на диске внешним процессом с момента последней
     * синхронизации (`diskStat`). Сверяем mtime и размер — этого достаточно,
     * чтобы поймать чужую запись и не спутать её с собственной. Отсутствие файла
     * (удалён/недоступен) не считаем конфликтом: `save` просто пересоздаст его.
     */
    private hasExternalChange(filePath: string): boolean {
        return this.differsFromDisk(this.readDiskStat(filePath));
    }

    /** Отличается ли stat файла от снимка последней синхронизации (`null` — файла нет). */
    private differsFromDisk(current: IDiskStat | null): boolean {
        if (this.diskStat === null || current === null) return false;
        return current.mtimeMs !== this.diskStat.mtimeMs || current.size !== this.diskStat.size;
    }

    /** (Пере)подписывается на внешние изменения текущего файла через `fileWatcher`. */
    private startWatchingFile(filePath: string): void {
        this.cancelOrphanCheck();
        this.fileWatch?.dispose();
        this.fileWatch =
            this.fileWatcher?.watchFile(filePath, () => {
                this.handleExternalFileChange(filePath);
            }) ?? null;
    }

    /**
     * Реакция на сигнал watcher'а. Собственную запись отсеиваем сверкой stat
     * (после save `diskStat` уже обновлён). Реальное внешнее изменение: чистый
     * буфер — тихо перечитываем с диска (как VS Code); «грязный» — взводим флаг
     * конфликта, чтобы предупредить при сохранении.
     *
     * Пропавший файл сразу удалением не считаем: это частый промежуточный шаг
     * атомарной записи чужим редактором. Через {@link ORPHAN_CHECK_DELAY_MS}
     * перепроверяем, и если файла всё ещё нет — модель orphaned (эталон).
     * Вернувшийся файл снимает флаг, а дальше — как любое внешнее изменение.
     */
    private handleExternalFileChange(filePath: string): void {
        const current = this.readDiskStat(filePath);
        if (current === null) {
            this.scheduleOrphanCheck(filePath);
            return;
        }
        this.cancelOrphanCheck();
        this.setOrphaned(false);
        if (!this.differsFromDisk(current)) return;
        if (this.isModified) {
            this.setDiskConflict(true);
        } else {
            this.revertToDisk();
            this.fireDiskStateChange();
        }
    }

    private scheduleOrphanCheck(filePath: string): void {
        // Файла не было уже при открытии — пропадать нечему.
        if (this.orphanedValue || this.diskStat === null) return;
        this.cancelOrphanCheck();
        this.orphanCheck = setTimeout(() => {
            this.orphanCheck = null;
            if (this.readDiskStat(filePath) === null) this.setOrphaned(true);
        }, ORPHAN_CHECK_DELAY_MS);
    }

    private cancelOrphanCheck(): void {
        clearTimeout(this.orphanCheck ?? undefined);
        this.orphanCheck = null;
    }

    private setOrphaned(value: boolean): void {
        if (this.orphanedValue === value) return;
        this.orphanedValue = value;
        this.onDidChangeOrphanedEmitter.fire();
        this.fireDiskStateChange();
    }

    private setDiskConflict(value: boolean): void {
        if (this.diskConflictValue === value) return;
        this.diskConflictValue = value;
        this.fireDiskStateChange();
    }

    private fireDiskStateChange(): void {
        this.onDidChangeDiskStateEmitter.fire();
    }

    /**
     * Language detection is delegated to the {@link ILanguageService}
     * (implemented by `LanguageRegistry` from the Extensions layer).
     */
    private resolveLanguageId(filePath: string): string {
        return this.languageService.getLanguageIdForResource(filePath) ?? "plaintext";
    }
}

/**
 * Кусок чтения файла. Не 64 КБ эталона (`readFileIntoStream`): декод куска
 * больше ~1 МБ (`EXTERN_APEX` node) node отдаёт внешней строкой — память вне
 * кучи V8, как у прежней одной строки файла. Куски по 64 КБ — обычные строки
 * кучи: она росла с запасом, и peak RSS на 13 МБ файле был +40 МБ к прежнему
 * (`bench:open`, A4 в docs/TODO/VscodeModel.md). 4 МБ — с запасом и для текста
 * в 2–3 байта на символ.
 */
export const READ_CHUNK_SIZE = 4 * 1024 * 1024;

/**
 * Файл кусками по {@link READ_CHUNK_SIZE}: открывается на первом куске,
 * закрывается в конце прохода или когда проход бросили. Нет файла — ни одного
 * куска (как прежнее «пустой буфер»). Веха `textfile:read` — когда прочитан
 * последний кусок.
 */
function* readFileChunks(filePath: string): Generator<Buffer> {
    let bytes = 0;
    if (fs.existsSync(filePath)) {
        const fd = fs.openSync(filePath, "r");
        try {
            for (;;) {
                // Новый буфер на кусок: декодер может держать хвост куска до следующего.
                const chunk = Buffer.allocUnsafe(READ_CHUNK_SIZE);
                const read = fs.readSync(fd, chunk, 0, READ_CHUNK_SIZE, null);
                if (read === 0) break;
                bytes += read;
                yield chunk.subarray(0, read);
            }
        } finally {
            fs.closeSync(fd);
        }
    }
    mark("textfile:read", { bytes });
}
