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

/** `conflict` — файл изменён снаружи с последней синхронизации, запись отменена; повтор — `{ overwrite: true }`. */
export type SaveOutcome = "saved" | "conflict" | "no-file";

interface IDiskStat {
    mtimeMs: number;
    size: number;
}

function diskEtag(stat: IDiskStat): string {
    return etag({ mtime: stat.mtimeMs, size: stat.size });
}

/** Номер безымянного назначает группа ({@link TextFileModel.setUntitled}) — она владеет счётчиком. */
const UNTITLED_PLACEHOLDER_URI = Uri.from({ scheme: "untitled", path: "Untitled" });

/**
 * Как `TextFileEditorModel.onDidFilesChange` эталона: атомарная запись чужим редактором —
 * удаление и тут же новый файл, поэтому пропажу перепроверяем через паузу.
 */
export const ORPHAN_CHECK_DELAY_MS = 100;

/**
 * Аналог `ITextFileEditorModel`: файл с диска, ресурс провайдера ФС расширения
 * ({@link openProvided}) либо безымянный буфер; синтетика — `SyntheticTextModel`.
 * Экземпляр на файл, создаёт `EditorService`.
 */
export class TextFileModel extends BaseTextEditorModel {
    /**
     * Состояние модели, а не документа: применяется на дисковой границе. Не undoable
     * и не входит в isModified — как в VS Code.
     */
    private encodingValue: string = DEFAULT_ENCODING;
    private readonly onDidChangeEncodingEmitter = this.register(new Emitter<void>());
    /** Отличает внешнее изменение от своей записи. `null` — файла не было при открытии. */
    private diskStat: IDiskStat | null = null;
    private diskConflictValue = false;
    private readonly onDidChangeDiskStateEmitter = this.register(new Emitter<void>());
    private fileWatch: IDisposable | null = null;
    /** `TextFileEditorModelState.ORPHAN` эталона. */
    private orphanedValue = false;
    private readonly onDidChangeOrphanedEmitter = this.register(new Emitter<void>());
    private orphanCheck: ReturnType<typeof setTimeout> | null = null;
    /** Асинхронный reopen сверяет его, прежде чем писать в документ. */
    private loadGeneration = 0;
    private providedWatch: IDisposable | null = null;

    public get encoding(): string {
        return this.encodingValue;
    }

    /** Неизвестные id игнорируются. Буфер не перечитывает — это {@link reopenWithEncoding}. */
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

    /** Первым подписан владелец-сервис (перепривязка реестра моделей), дальше — вкладки. */
    public readonly onDidSaveDocument = this.onDidSaveDocumentEmitter.event;

    private fireSaved(): void {
        this.onDidSaveDocumentEmitter.fire();
    }

    /** Инъектируется группой перед openFile; `null` — без live-watch. */
    public fileWatcher: IFileWatcher | null = null;

    /** Общий для всех моделей `EditorService`; прогоняется и в `save`, и в `saveAs`. */
    public saveParticipant: TextFileSaveParticipant | null = null;

    /** Файл изменён снаружи при несохранённых правках: авто-перечитать нельзя. */
    public get hasDiskConflict(): boolean {
        return this.diskConflictValue;
    }

    /** Подписка живёт на модели и переживает пересоздание документа в openFile. */
    public readonly onDidChangeDiskState = this.onDidChangeDiskStateEmitter.event;

    /**
     * Снимается, когда файл вернулся, и после сохранения. Безымянный буфер и файл,
     * которого не было уже при открытии, orphaned не бывают.
     */
    public get isOrphaned(): boolean {
        return this.orphanedValue;
    }

    /** Следом файрится и {@link onDidChangeDiskState}; отдельно — для `workbench.editor.closeOnFileDelete`. */
    public readonly onDidChangeOrphaned = this.onDidChangeOrphanedEmitter.event;

    public readonly onDidChangeEncoding = this.onDidChangeEncodingEmitter.event;

    /**
     * Гейт по схеме, а не по «`fsPath` непустой»: у не-file схемы `fsPath` отдаёт путь
     * как есть (`untitled:Untitled-1` → `"Untitled-1"`), и он ушёл бы в `node:fs` как относительный.
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
     * @param files Запись — через файловый сервис (атомарно, гард по etag). Чтение пока
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

    protected override get undoResources(): string[] {
        const filePath = this.filePath;
        return filePath === null ? [] : [filePath];
    }

    /** Звать до того, как редактор попадёт в список вкладок и станет кому-то виден. */
    public setUntitled(untitledNumber: number): void {
        this.uriValue = Uri.from({ scheme: "untitled", path: `Untitled-${untitledNumber}` });
    }

    /**
     * Относительные пути резолвит группа до подъёма в uri: `Uri.file` их не резолвит,
     * после подъёма было бы поздно.
     */
    public openFile(uri: Uri): void {
        // Без гейта `git:`-ресурс молча показал бы рабочее дерево и повесил watcher
        // на чужой путь. Не-file буферы — `openSynthetic`.
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
     * Ресурс провайдера ФС расширения (`_claude_fs_right:` у Claude Code) — как файл
     * в эталоне. Байты читает вызывающий: чтение провайдера асинхронное, а модель
     * рождается в реестре синхронно.
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
     * Своя запись тоже приходит событием — её отличаем по тексту: перечитка того же
     * текста стирала бы историю отмены при каждом сохранении.
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

    /** Кодировка пере-детектится (сниф BOM, иначе utf-8), как reload в VS Code; явная — {@link reopenWithEncoding}. */
    private loadDocumentFromDisk(filePath: string): void {
        this.applyDecoded(filePath, decodeStreamByBOM(this.readDiskChunks(filePath)));
    }

    private readDiskChunks(filePath: string): Iterable<Buffer> {
        // Stryker disable next-line UpdateOperator: поколение сверяется только на равенство — «--» тоже новое значение
        this.loadGeneration++;
        return readFileChunks(filePath);
    }

    /** Буфер собирается прямо из кусков декодера: строки всего файла не бывает (A4, docs/TODO/VscodeModel.md). */
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
        // Вехи лестницы старта (docs/TODO/OpenPerformance.md).
        mark("textfile:decoded", { chars });
        this.applyEncoding(encoding);
        this.diskStat = this.readDiskStat(filePath);
        this.diskConflictValue = false;
        // Файл вернулся, а watcher промолчал. Пропавший файл перечитка не воскрешает.
        if (this.diskStat !== null) this.setOrphaned(false);
        this.replaceText(factory);
        mark("textfile:document-built", { lines: this.doc.lineCount });
        // Язык — после текста: при первом открытии смена языка пересаживает
        // токенизатор готовым вью на документ с текстом, а не на пустой.
        this.doc.setLanguage(this.resolveLanguageId(filePath));
    }

    public async save(options?: { overwrite?: boolean }): Promise<SaveOutcome> {
        const filePath = this.filePath;
        if (filePath === null && !this.isProvided) return "no-file";
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
        this.setOrphaned(false);
        this.fireSaved();
        return "saved";
    }

    /** "no-file" — вызывающий уводит в Save As; кодировка при этом уже выставлена. */
    public async saveWithEncoding(encoding: string, options?: { overwrite?: boolean }): Promise<SaveOutcome> {
        this.setEncoding(encoding);
        return this.save(options);
    }

    public revertToDisk(): boolean {
        if (this.filePath === null) return false;
        this.loadDocumentFromDisk(this.filePath);
        return true;
    }

    /**
     * Правки «грязной» вкладки, переехавшие за rename/move в проводнике: как
     * `resolve({ contents })` у `TextFileEditorModelManager` эталона на MOVE —
     * модель остаётся изменённой, история отмены с нуля.
     */
    public restoreUnsavedContents(text: string): void {
        this.replaceText(text, { unsaved: true });
    }

    /**
     * Подтверждение у «грязного» буфера спрашивает вызывающий. `false` — нет файла
     * либо перечитку обогнала другая (декод не-Unicode ждёт iconv).
     */
    public async reopenWithEncoding(encoding: string): Promise<boolean> {
        const filePath = this.filePath;
        if (filePath === null) return false;
        const chunks = this.readDiskChunks(filePath);
        const generation = this.loadGeneration;
        const decoded = await decodeStream(chunks, encoding);
        // Начатое чтение дочитывается и устаревшим: проход закрывает файл.
        if (generation !== this.loadGeneration || filePath !== this.filePath) {
            Array.from(decoded.text);
            return false;
        }
        this.applyDecoded(filePath, decoded);
        return true;
    }

    /**
     * Unlike {@link openFile}, undo history survives: the undo bucket is keyed by
     * {@link undoContext}, tied to the editor rather than to its path.
     */
    public async saveAs(newPath: string): Promise<void> {
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

    private readDiskStat(filePath: string): IDiskStat | null {
        try {
            const stat = fs.statSync(filePath);
            return { mtimeMs: stat.mtimeMs, size: stat.size };
        } catch {
            return null;
        }
    }

    /** Отсутствие файла — не конфликт: `save` его пересоздаст. */
    private hasExternalChange(filePath: string): boolean {
        return this.differsFromDisk(this.readDiskStat(filePath));
    }

    private differsFromDisk(current: IDiskStat | null): boolean {
        if (this.diskStat === null || current === null) return false;
        return current.mtimeMs !== this.diskStat.mtimeMs || current.size !== this.diskStat.size;
    }

    private startWatchingFile(filePath: string): void {
        this.cancelOrphanCheck();
        this.fileWatch?.dispose();
        this.fileWatch =
            this.fileWatcher?.watchFile(filePath, () => {
                this.handleExternalFileChange(filePath);
            }) ?? null;
    }

    /** Свою запись отсеивает сверка stat: после save `diskStat` уже обновлён. */
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

    private resolveLanguageId(filePath: string): string {
        return this.languageService.getLanguageIdForResource(filePath) ?? "plaintext";
    }
}

/**
 * Не 64 КБ эталона (`readFileIntoStream`): куски по 64 КБ — обычные строки кучи,
 * peak RSS на 13 МБ файле был +40 МБ (`bench:open`, A4). Больше ~1 МБ (`EXTERN_APEX`)
 * node отдаёт внешней строкой вне кучи V8; 4 МБ — с запасом и для 2–3 байт на символ.
 */
export const READ_CHUNK_SIZE = 4 * 1024 * 1024;

/** Файл закрывается в конце прохода или когда проход бросили. Нет файла — ни одного куска. */
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
