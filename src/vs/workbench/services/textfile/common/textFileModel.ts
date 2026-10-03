import * as fs from "node:fs";
import * as path from "node:path";

import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { mark } from "../../../../base/common/performance.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import {
    decodeBuffer,
    DEFAULT_ENCODING,
    encodeText,
    getEncodingInfo,
} from "../../../../editor/common/model/encoding.ts";
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

/**
 * Ресурс свежесозданной модели: безымянный буфер без номера. Номер назначает группа
 * ({@link TextFileModel.setUntitled}) — она владеет счётчиком; до этого модель ещё
 * никто не видит.
 */
const UNTITLED_PLACEHOLDER_URI = Uri.from({ scheme: "untitled", path: "Untitled" });

/**
 * Per-file модель текстового файла без view (аналог `ITextFileEditorModel` VS Code):
 * поверх буфера ({@link BaseTextEditorModel}: документ, язык, EOL, история) — ось
 * кодировки, dirty-статус против диска, запись на диск (save/saveAs + save-участник)
 * и слежение за файлом (авто-перечитка чистого буфера / флаг конфликта у
 * «грязного»). Файл с диска либо безымянный буфер; синтетика (Output, виртуальные
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
     * `saveAs`. Не задан ⇒ участников нет, save синхронен.
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
     */
    public constructor(languageService: ILanguageService, undoRedoService: UndoRedoService) {
        super(languageService, undoRedoService, UNTITLED_PLACEHOLDER_URI);
        this.register({
            dispose: () => {
                this.fileWatch?.dispose();
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
        this.startWatchingFile(filePath);
    }

    /** Заменяет содержимое буфера целиком (смена активного Output-канала). */
    /**
     * Читает файл с диска в документ модели ({@link replaceText}: история
     * отмены сбрасывается, view ремапит каретку и скролл как при любой правке).
     * Общий путь для
     * {@link openFile}, {@link revertToDisk} и {@link reopenWithEncoding}. Обновляет
     * снимок `diskStat` и снимает флаг конфликта. Кодировка: `explicitEncoding`
     * побеждает BOM-сниф; без него — сниф BOM, иначе utf-8 (revert пере-детектит,
     * как reload в VS Code).
     */
    private loadDocumentFromDisk(filePath: string, explicitEncoding?: string): void {
        const buffer = fs.existsSync(filePath) ? fs.readFileSync(filePath) : Buffer.alloc(0);
        // Вехи лестницы старта (docs/TODO/OpenPerformance.md): без трассы — no-op.
        mark("textfile:read", { bytes: buffer.length });
        const { text: content, encoding } = decodeBuffer(buffer, explicitEncoding);
        mark("textfile:decoded", { chars: content.length });
        this.applyEncoding(encoding);
        this.diskStat = this.readDiskStat(filePath);
        this.diskConflictValue = false;
        this.replaceText(content);
        mark("textfile:document-built", { lines: this.doc.lineCount });
        // Язык — после текста: у перечитки того же файла он прежний (no-op), а
        // у первого открытия смена языка пересаживает токенизатор уже готовым
        // вью — на документ с текстом, а не на пустой.
        this.doc.setLanguage(this.resolveLanguageId(filePath));
    }

    public async save(options?: { overwrite?: boolean }): Promise<SaveOutcome> {
        if (this.filePath === null) return "no-file";
        // Защита от затирания параллельных правок: если файл на диске изменился
        // внешним процессом с момента открытия/последней записи — не пишем, а
        // сообщаем о конфликте. Повторный вызов с overwrite: true форсит запись.
        if (options?.overwrite !== true && this.hasExternalChange(this.filePath)) {
            this.setDiskConflict(true);
            return "conflict";
        }
        // Когда участников нет — до writeFileSync нет ни одного await, запись
        // остаётся синхронной в текущем тике (вызовы save() без await работают).
        const participation = this.saveParticipant?.participate(this) ?? null;
        if (participation !== null) await participation;
        fs.writeFileSync(this.filePath, encodeText(this.doc.serialize(), this.encodingValue));
        this.diskStat = this.readDiskStat(this.filePath);
        this.markSaved();
        this.setDiskConflict(false);
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
     * Перечитывает файл с диска в указанной кодировке («Reopen with Encoding»),
     * отбрасывая несохранённые правки — подтверждение у «грязного» буфера
     * спрашивает вызывающий. Возвращает `false` для буфера без файла на диске.
     */
    public reopenWithEncoding(encoding: string): boolean {
        if (this.filePath === null) return false;
        this.loadDocumentFromDisk(this.filePath, encoding);
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
        // Смена идентичности на месте: у безымянного буфера это переход untitled: → file:.
        this.uriValue = Uri.file(path.resolve(newPath));
        const participation = this.saveParticipant?.participate(this) ?? null;
        if (participation !== null) await participation;
        fs.writeFileSync(newPath, encodeText(this.doc.serialize(), this.encodingValue));
        this.diskStat = this.readDiskStat(newPath);
        this.doc.setLanguage(this.resolveLanguageId(newPath));
        this.markSaved();
        this.setDiskConflict(false);
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
        if (this.diskStat === null) return false;
        const current = this.readDiskStat(filePath);
        if (current === null) return false;
        return current.mtimeMs !== this.diskStat.mtimeMs || current.size !== this.diskStat.size;
    }

    /** (Пере)подписывается на внешние изменения текущего файла через `fileWatcher`. */
    private startWatchingFile(filePath: string): void {
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
     * конфликта, чтобы предупредить при сохранении. Удаление/недоступность
     * игнорируем (частый промежуточный шаг атомарной записи чужим редактором).
     */
    private handleExternalFileChange(filePath: string): void {
        if (!this.hasExternalChange(filePath)) return;
        if (this.isModified) {
            this.setDiskConflict(true);
        } else {
            this.revertToDisk();
            this.fireDiskStateChange();
        }
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
