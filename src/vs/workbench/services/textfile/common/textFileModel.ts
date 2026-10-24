import * as fs from "node:fs";
import * as path from "node:path";

import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { mark } from "../../../../base/common/performance.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import {
    DiskTextBuffer,
    type IDiskIndexingProgress,
    MAX_STRING_LENGTH,
} from "../../../../editor/common/model/diskTextBuffer.ts";
import {
    decodeBufferByBOM,
    DEFAULT_ENCODING,
    getEncodingInfo,
    resolveDecodeEncoding,
} from "../../../../editor/common/model/encoding.ts";
import {
    decodeStream,
    decodeStreamByBOM,
    encodeChunks,
    type IDecodedStream,
} from "../../../../editor/common/model/encodingStream.ts";
import {
    DEFAULT_LARGE_FILE_OPTIONS,
    type ILargeFileOptions,
    isTooLargeForTokenization,
} from "../../../../editor/common/model/largeFileOptions.ts";
import { createTextBufferFactoryFromChunks } from "../../../../editor/common/model/textDocument.ts";
import {
    etag,
    FileOperationResult,
    type IFileService,
    type IFileStat,
    isFileOperationError,
} from "../../../../platform/files/common/files.ts";
import type { IFileWatcher } from "../../../../platform/files/common/iFileWatcher.ts";
import type { IRandomAccessFileOpener } from "../../../../platform/files/common/iRandomAccessFile.ts";
import type { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { BaseTextEditorModel } from "../../../common/editor/textEditorModel.ts";

import type { TextFileSaveParticipant } from "./textFileSaveParticipant.ts";

/** `conflict`: the file changed externally since the last sync and the write was cancelled; retry with `{ overwrite: true }`. */
export type SaveOutcome = "saved" | "conflict" | "no-file";

interface IDiskStat {
    mtimeMs: number;
    size: number;
}

function diskEtag(stat: IDiskStat): string {
    return etag({ mtime: stat.mtimeMs, size: stat.size });
}

/** The untitled number is assigned by the group ({@link TextFileModel.setUntitled}), which owns the counter. */
const UNTITLED_PLACEHOLDER_URI = Uri.from({ scheme: "untitled", path: "Untitled" });

/**
 * Like upstream `TextFileEditorModel.onDidFilesChange`: another editor's atomic write is a
 * delete immediately followed by a new file, so a disappearance is re-checked after a delay.
 */
export const ORPHAN_CHECK_DELAY_MS = 100;

/**
 * Counterpart of `ITextFileEditorModel`: a file on disk, a resource of an extension's FS provider
 * ({@link openProvided}) or an untitled buffer; synthetic content is `SyntheticTextModel`.
 * One instance per file, created by `EditorService`.
 */
export class TextFileModel extends BaseTextEditorModel {
    /**
     * State of the model, not of the document: applied at the disk boundary. Not undoable
     * and not part of isModified, as in VS Code.
     */
    private encodingValue: string = DEFAULT_ENCODING;
    private readonly onDidChangeEncodingEmitter = this.register(new Emitter<void>());
    /** Tells an external change from our own write. `null`: the file did not exist when opened. */
    private diskStat: IDiskStat | null = null;
    private diskConflictValue = false;
    private readonly onDidChangeDiskStateEmitter = this.register(new Emitter<void>());
    private fileWatch: IDisposable | null = null;
    /** Upstream `TextFileEditorModelState.ORPHAN`. */
    private orphanedValue = false;
    private readonly onDidChangeOrphanedEmitter = this.register(new Emitter<void>());
    private orphanCheck: ReturnType<typeof setTimeout> | null = null;
    /** An async reopen checks it before writing into the document. */
    private loadGeneration = 0;
    private providedWatch: IDisposable | null = null;

    public get encoding(): string {
        return this.encodingValue;
    }

    /** Unknown ids are ignored. Does not re-read the buffer; that is {@link reopenWithEncoding}. */
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

    /** The owning service subscribes first (model registry rebinding), tabs come after. */
    public readonly onDidSaveDocument = this.onDidSaveDocumentEmitter.event;

    private fireSaved(): void {
        this.onDidSaveDocumentEmitter.fire();
    }

    /** Injected by the group before openFile; `null` means no live watch. */
    public fileWatcher: IFileWatcher | null = null;

    /** Shared by all models of `EditorService`; runs in both `save` and `saveAs`. */
    public saveParticipant: TextFileSaveParticipant | null = null;

    /**
     * Upstream `ModelService.getCreationOptions`: `editor.largeFileOptimizations` and the thresholds, read
     * per language at the first load. Injected by the owning service; the default is the upstream constants.
     */
    public largeFileOptions: (languageId: string) => ILargeFileOptions = () => DEFAULT_LARGE_FILE_OPTIONS;

    /**
     * Positional reads for the document on disk (docs/arch/Editor.md). Injected by the owning service; without
     * it (tests, synthetic hosts) a large file is read into memory as before.
     */
    public randomAccessFiles: IRandomAccessFileOpener | null = null;
    private onDiskDeclinedReasonValue: "encoding" | null = null;
    private readonly onDidChangeDiskIndexingEmitter = this.register(new Emitter<void>());

    /** Progress of the index of the document on disk; fires with each chunk and at the end. */
    public readonly onDidChangeDiskIndexing = this.onDidChangeDiskIndexingEmitter.event;

    /** The text lives on disk and is read by lines (the large-file mode above the size threshold). */
    public get isOnDisk(): boolean {
        return this.doc.onDisk !== null;
    }

    /** `null` when the document is in memory. */
    public get diskIndexing(): IDiskIndexingProgress | null {
        return this.doc.onDisk?.indexing ?? null;
    }

    /**
     * Why a file above the size threshold is in memory anyway: the document on disk reads UTF-8 only (human's
     * decision 2026-10-23), a UTF-16 file takes the old path, and the toast says so.
     */
    public get onDiskDeclinedReason(): "encoding" | null {
        return this.onDiskDeclinedReasonValue;
    }

    /** The file changed externally while there are unsaved edits, so it cannot be auto-reloaded. */
    public get hasDiskConflict(): boolean {
        return this.diskConflictValue;
    }

    /** The subscription lives on the model and survives document re-creation in openFile. */
    public readonly onDidChangeDiskState = this.onDidChangeDiskStateEmitter.event;

    /**
     * Cleared when the file comes back and after a save. An untitled buffer and a file
     * that was already missing when opened are never orphaned.
     */
    public get isOrphaned(): boolean {
        return this.orphanedValue;
    }

    /** {@link onDidChangeDiskState} fires right after; this one is separate for `workbench.editor.closeOnFileDelete`. */
    public readonly onDidChangeOrphaned = this.onDidChangeOrphanedEmitter.event;

    public readonly onDidChangeEncoding = this.onDidChangeEncodingEmitter.event;

    /**
     * Gated by scheme, not by "`fsPath` is non-empty": for a non-file scheme `fsPath` returns the path
     * as is (`untitled:Untitled-1` → `"Untitled-1"`), and it would reach `node:fs` as a relative path.
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
     * @param files Writes go through the file service (atomic, guarded by etag). Reads are still
     * synchronous and bypass the service (docs/TODO/FileService.md, PR 5).
     */
    public constructor(
        languageService: ILanguageService,
        undoRedoService: UndoRedoService,
        private readonly files: IFileService,
    ) {
        super(languageService, undoRedoService, UNTITLED_PLACEHOLDER_URI);
        this.register({
            dispose: () => {
                // A pending reopen must not write into a disposed model.
                // Stryker disable next-line UpdateOperator: see readDiskBytes
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

    /** Call before the editor enters the tab list and becomes visible to anyone. */
    public setUntitled(untitledNumber: number): void {
        this.uriValue = Uri.from({ scheme: "untitled", path: `Untitled-${untitledNumber}` });
    }

    /**
     * The group resolves relative paths before lifting them into a uri: `Uri.file` does not
     * resolve them, and after lifting it would be too late.
     */
    public openFile(uri: Uri): void {
        // Without the gate a `git:` resource would silently show the working tree and attach
        // a watcher to someone else's path. Non-file buffers go through `openSynthetic`.
        if (uri.scheme !== "file") {
            throw new Error(`TextFileModel.openFile: expected a file: uri, got ${uri.scheme}:`);
        }
        this.uriValue = uri;
        const filePath = uri.fsPath;
        // Above the size threshold the document stays on disk and the mode is on by construction; otherwise
        // the file is read into memory and the line-count axis decides.
        if (!this.openOnDisk(filePath)) {
            this.loadDocumentFromDisk(filePath);
            this.decideLargeFile();
        }
        this.adoptWorkspaceUndo(filePath, path.basename(filePath));
        this.startWatchingFile(filePath);
    }

    /**
     * Once, on the first load, like upstream's decision in the `TextModel` constructor: a reload (revert,
     * encoding, external change) keeps it. Measured on the built document: the piece tree knows both numbers.
     */
    private decideLargeFile(): void {
        const options = this.largeFileOptions(this.doc.languageId);
        if (isTooLargeForTokenization(this.doc.getValueLength(), this.doc.lineCount, options)) {
            this.markTooLargeForTokenization();
        }
    }

    /**
     * The document on disk (docs/arch/Editor.md): a file above the size threshold — bytes on disk, where upstream
     * counts characters — is not read into memory. The first chunk is indexed here, synchronously, so the model is
     * born with its first screen; the rest of the index is built in the background. UTF-8 and ASCII only: a BOM
     * of UTF-16 sends the file down the old path, with {@link onDiskDeclinedReason} for the toast. `false` — not
     * on disk, load as before.
     */
    private openOnDisk(filePath: string): boolean {
        const opener = this.randomAccessFiles;
        if (opener === null) return false;
        const languageId = this.resolveLanguageId(filePath);
        const stat = this.readDiskStat(filePath);
        if (stat === null || !isTooLargeForTokenization(stat.size, 0, this.largeFileOptions(languageId))) {
            return false;
        }
        let file;
        try {
            file = opener.open(filePath);
        } catch (error) {
            // Unreadable (EACCES, a directory): the old path reports it the way it always did. Anything else is a bug.
            if (!isFileSystemError(error)) throw error;
            return false;
        }
        const head = Buffer.alloc(BOM_SNIFF_LENGTH);
        const info = resolveDecodeEncoding(head.subarray(0, file.readSync(head, 0)), undefined);
        if (info.iconvName !== "utf8") {
            file.dispose();
            this.onDiskDeclinedReasonValue = "encoding";
            return false;
        }
        this.onDiskDeclinedReasonValue = null;
        // Stryker disable next-line UpdateOperator: see readDiskBytes
        this.loadGeneration++;
        const buffer = new DiskTextBuffer(file, { bomLength: info.id === "utf8bom" ? BOM_SNIFF_LENGTH : 0 });
        // The startup ladder marks (docs/TODO/OpenPerformance.md): read and decoded are the first chunk.
        mark("textfile:read", { bytes: buffer.indexing.indexedBytes });
        mark("textfile:decoded", { chars: buffer.getValueLength() });
        this.applyEncoding(info.id);
        this.diskStat = stat;
        // No conflict to clear: a document on disk is read-only, and the mode never turns on after an edit.
        this.setOrphaned(false);
        this.replaceText(buffer);
        mark("textfile:document-built", { lines: this.doc.lineCount });
        this.markTooLargeForTokenization();
        this.doc.setLanguage(languageId);
        // The buffer's emitter dies with the buffer (the next reload disposes it), so the relay needs no bookkeeping.
        buffer.onDidChangeIndexing(() => {
            this.onDidChangeDiskIndexingEmitter.fire();
        });
        buffer.startIndexing();
        return true;
    }

    /**
     * Upstream's "Forcefully Enable Features" on a document on disk first reads the file into memory the old
     * way (stage 4.5 of OpenPerformance streams it with progress). A file no string can hold stays on disk:
     * the features being enabled (`getText()` for providers, formatting, sync) could not work on it anyway.
     */
    public override forcefullyEnableFeatures(): boolean {
        const disk = this.doc.onDisk;
        const filePath = this.filePath;
        // Stryker disable next-line ConditionalExpression: a document on disk always came from a path; the second check is for the type
        if (disk !== null && filePath !== null) {
            if (disk.size > MAX_STRING_LENGTH) return false;
            this.applyDecoded(filePath, decodeStreamByBOM(this.readDiskChunks(filePath)));
        }
        return super.forcefullyEnableFeatures();
    }

    /**
     * A resource of an extension's FS provider (`_claude_fs_right:` in Claude Code), treated as
     * a file like upstream. The caller reads the bytes: provider reads are async, while the
     * model is born in the registry synchronously.
     */
    public openProvided(uri: Uri, bytes: Uint8Array): void {
        if (uri.scheme === "file" || uri.scheme === "untitled") {
            throw new Error(`TextFileModel.openProvided: expected a provider resource, got ${uri.scheme}:`);
        }
        this.uriValue = uri;
        this.applyProvided(bytes);
        this.decideLargeFile();
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
     * Our own write also arrives as an event and is told apart by text: re-reading the same
     * text would wipe the undo history on every save.
     */
    private async reloadProvided(): Promise<void> {
        // Stryker disable next-line UpdateOperator: see readDiskBytes
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
     * The encoding is re-detected (BOM sniff, otherwise utf-8), like reload in VS Code; an explicit one is
     * {@link reopenWithEncoding}. A reload of a model in the large-file mode goes back on disk when the file is
     * still above the threshold (a reload never turns the mode on: upstream's "decided once").
     */
    private loadDocumentFromDisk(filePath: string): void {
        if (this.isTooLargeForTokenization && this.openOnDisk(filePath)) return;
        this.applyDecoded(filePath, decodeStreamByBOM(this.readDiskChunks(filePath)));
    }

    private readDiskChunks(filePath: string): Iterable<Buffer> {
        // Stryker disable next-line UpdateOperator: the generation is only compared for equality, so "--" is a new value too
        this.loadGeneration++;
        return readFileChunks(filePath);
    }

    /** The buffer is built straight from decoder chunks: a whole-file string never exists (A4, docs/TODO/VscodeModel.md). */
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
        // Startup ladder marks (docs/TODO/OpenPerformance.md).
        mark("textfile:decoded", { chars });
        this.applyEncoding(encoding);
        this.diskStat = this.readDiskStat(filePath);
        this.diskConflictValue = false;
        // The file came back but the watcher stayed silent. A reload does not resurrect a missing file.
        if (this.diskStat !== null) this.setOrphaned(false);
        this.replaceText(factory);
        mark("textfile:document-built", { lines: this.doc.lineCount });
        // Language goes after the text: on first open a language change moves the tokenizer
        // of an already-built view onto the document with text rather than an empty one.
        this.doc.setLanguage(this.resolveLanguageId(filePath));
    }

    public async save(options?: { overwrite?: boolean }): Promise<SaveOutcome> {
        const filePath = this.filePath;
        if (filePath === null && !this.isProvided) return "no-file";
        // A document on disk cannot be modified, so the file already holds its text: writing it back would
        // stream the whole file through one buffer for nothing.
        if (this.isOnDisk) return "saved";
        // A provider resource has no snapshot: its conflict is raised by the reload.
        // Stryker disable next-line ConditionalExpression: equivalent, since without a file `diskStat` is empty and a "no file" stat does not differ from it
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
                // Same guard as above, but at write time: the file may have changed
                // externally while participants were running.
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

    /** "no-file": the caller falls back to Save As; the encoding is already set by then. */
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
     * Edits of a dirty tab carried over by a rename/move in the explorer: like upstream
     * `TextFileEditorModelManager` `resolve({ contents })` on MOVE, the model stays
     * modified and the undo history starts from scratch.
     */
    public restoreUnsavedContents(text: string): void {
        this.replaceText(text, { unsaved: true });
    }

    /**
     * The caller asks for confirmation on a dirty buffer. `false`: no file, or another
     * reload overtook this one (non-Unicode decoding waits for iconv).
     */
    public async reopenWithEncoding(encoding: string): Promise<boolean> {
        const filePath = this.filePath;
        if (filePath === null) return false;
        const chunks = this.readDiskChunks(filePath);
        const generation = this.loadGeneration;
        const decoded = await decodeStream(chunks, encoding);
        // A started read is drained even when stale: the pass closes the file.
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
        // Stage 4.5 streams a copy; until then the snapshot would go through one buffer of the file's size.
        if (this.isOnDisk) throw new Error("Save As is not available for a document on disk; Enable Editing first");
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

    /** A missing file is not a conflict: `save` re-creates it. */
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

    /** The stat comparison filters out our own write: after save `diskStat` is already updated. */
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
        // The file was already missing when opened, so nothing can disappear.
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
 * Not upstream's 64 KB (`readFileIntoStream`): 64 KB chunks become regular heap strings, and
 * peak RSS on a 13 MB file was +40 MB (`bench:open`, A4). Above ~1 MB (`EXTERN_APEX`) node
 * returns an external string outside the V8 heap; 4 MB leaves headroom for 2–3 bytes per char.
 */
export const READ_CHUNK_SIZE = 4 * 1024 * 1024;

/** The longest BOM (utf-8): enough to tell utf-8 from UTF-16 before deciding where the text lives. */
const BOM_SNIFF_LENGTH = 3;

/** The file is closed at the end of the pass or when the pass is abandoned. No file yields no chunks. */
function* readFileChunks(filePath: string): Generator<Buffer> {
    let bytes = 0;
    if (fs.existsSync(filePath)) {
        const fd = fs.openSync(filePath, "r");
        try {
            for (;;) {
                // A fresh buffer per chunk: the decoder may hold a chunk's tail until the next one.
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

/** An `fs` failure carries a `code` (EACCES, EISDIR); a thrown `TypeError` does not. */
function isFileSystemError(error: unknown): boolean {
    return error instanceof Error && typeof (error as { code?: unknown }).code === "string";
}
