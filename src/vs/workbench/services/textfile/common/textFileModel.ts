import * as fs from "node:fs";
import * as path from "node:path";

import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { mark } from "../../../../base/common/performance.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import {
    DISK_TAIL_CHECK_BYTES,
    DiskTextBuffer,
    type IDiskIndexingProgress,
    MAX_STRING_LENGTH,
} from "../../../../editor/common/model/diskTextBuffer.ts";
import {
    decodeBufferByBOM,
    DEFAULT_ENCODING,
    getEncodingInfo,
    resolveDecodeEncoding,
    stripBOM,
} from "../../../../editor/common/model/encoding.ts";
import {
    createStreamDecoder,
    decodeStream,
    decodeStreamByBOM,
    encodeStream,
    type IDecodedStream,
} from "../../../../editor/common/model/encodingStream.ts";
import {
    DEFAULT_LARGE_FILE_OPTIONS,
    type ILargeFileOptions,
    isTooLargeForTokenization,
} from "../../../../editor/common/model/largeFileOptions.ts";
import {
    createTextBufferFactoryBuilder,
    createTextBufferFactoryFromChunks,
} from "../../../../editor/common/model/textDocument.ts";
import {
    etag,
    FileOperationResult,
    type IFileService,
    type IFileStat,
    isFileOperationError,
} from "../../../../platform/files/common/files.ts";
import type { IFileWatcher } from "../../../../platform/files/common/iFileWatcher.ts";
import type {
    IRandomAccessFile,
    IRandomAccessFileOpener,
} from "../../../../platform/files/common/iRandomAccessFile.ts";
import type { IMemoryProbe } from "../../../../platform/memory/common/iMemoryProbe.ts";
import type { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { BaseTextEditorModel, type EnableEditingRefusal } from "../../../common/editor/textEditorModel.ts";

import type { TextFileSaveParticipant } from "./textFileSaveParticipant.ts";

/** `conflict`: the file changed externally since the last sync and the write was cancelled; retry with `{ overwrite: true }`. */
export type SaveOutcome = "saved" | "conflict" | "no-file";

interface IDiskStat {
    mtimeMs: number;
    size: number;
    /** Tells the same file grown from another one under the same name (a rotated log); unknown after our own write. */
    ino?: number;
}

function diskEtag(stat: IDiskStat): string {
    return etag({ mtime: stat.mtimeMs, size: stat.size });
}

/** The untitled number is assigned by the group ({@link TextFileModel.setUntitled}), which owns the counter. */
const UNTITLED_PLACEHOLDER_URI = Uri.from({ scheme: "untitled", path: "Untitled" });

export function untitledUriOf(untitledNumber: number): Uri {
    return Uri.from({ scheme: "untitled", path: `Untitled-${untitledNumber}` });
}

/**
 * Like upstream `TextFileEditorModel.onDidFilesChange`: another editor's atomic write is a
 * delete immediately followed by a new file, so a disappearance is re-checked after a delay.
 */
export const ORPHAN_CHECK_DELAY_MS = 100;

/** Progress of a file streaming into memory ({@link TextFileModel.memoryLoading}). */
export interface IMemoryLoadingProgress {
    readonly loadedBytes: number;
    readonly totalBytes: number;
}

/**
 * Memory a file takes per byte once in a piece tree, as a bound: one byte per character of an ASCII text (two for
 * UTF-16 strings), the line starts, and the features that come back with editing. Checked before the stream starts.
 */
export const MEMORY_PER_FILE_BYTE = 2;

/** The stream stops when less than this is left: the process must survive the refusal and paint its toast. */
export const MEMORY_RESERVE_BYTES = 256 * 1024 * 1024;

/** Outcome of {@link TextFileModel.streamIntoMemory}: `modified` — the buffer was edited while the file streamed in. */
type StreamOutcome = EnableEditingRefusal | "modified" | null;

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
    /**
     * Where a document in memory ends in its file (follow, OpenPerformance 4.4): the bytes read, and the last of
     * them ({@link DISK_TAIL_CHECK_BYTES}) to tell an append from a rewrite. `null` — growth reloads: not UTF-8,
     * not read from the file (a save, a provider), or on disk (the buffer keeps its own).
     */
    private memoryEnd: { bytes: number; tail: Buffer } | null = null;
    /** Bytes of the last {@link readDiskChunks} pass, set when it ends. */
    private loadedBytes = 0;
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

    public override get encoding(): string {
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

    /** Upstream `hasAssociatedFilePath`. Cleared when the buffer becomes a file. */
    private hasAssociatedResource = false;
    private markedDirtyForExtensions = false;

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
    /** Asked before and while a large file streams into memory. Injected by the owning service; without it, nobody asks. */
    public memory: IMemoryProbe | null = null;
    private onDiskDeclinedReasonValue: "encoding" | null = null;
    /** The progress and the load that owns it: a newer load replaces it, an older one must not clear it. */
    private memoryLoadingState: { readonly generation: number; readonly progress: IMemoryLoadingProgress } | null =
        null;
    private readonly onDidChangeMemoryLoadingEmitter = this.register(new Emitter<void>());
    /**
     * "Enable Editing" is streaming the file in: an external change waits for the switch (the stat check after it
     * reloads), instead of reopening the document on disk under the load and cancelling it (QA 4.5: a log written to
     * while it loaded stayed read-only for good).
     */
    private streamingForEditing = false;
    /** A second click on "Enable Editing" while the file streams in waits for the same load. */
    private pendingEnableEditing: Promise<EnableEditingRefusal | null> | null = null;

    /** Fires as a large file streams into memory, chunk by chunk, and when it ends either way. */
    public readonly onDidChangeMemoryLoading = this.onDidChangeMemoryLoadingEmitter.event;

    /**
     * A large file streaming into memory ("Enable Editing" on the document on disk, a reload of a large in-memory
     * buffer); `null` when nothing is. The status bar shows it.
     */
    public get memoryLoading(): IMemoryLoadingProgress | null {
        return this.memoryLoadingState?.progress ?? null;
    }
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
        this.uriValue = untitledUriOf(untitledNumber);
    }

    /**
     * An untitled buffer under a resource an extension named (upstream `associatedResource`). `associated` makes it
     * dirty from the start, whatever its text: it is a file that has yet to be written.
     */
    public setUntitledResource(uri: Uri, { associated }: { associated: boolean }): void {
        this.uriValue = uri;
        this.hasAssociatedResource = associated;
        if (associated)
            this.doc.setLanguage(this.languageService.getLanguageIdForResource(uri.path) ?? this.languageId);
    }

    public override get isModified(): boolean {
        if (this.hasAssociatedResource) return true;
        // Upstream `onModelContentChanged`: an untitled buffer that became empty never shows a dirty indicator.
        if (this.uriValue.scheme === "untitled" && this.doc.getValueLength() === 0)
            return this.doc.eol !== this.savedEol;
        return super.isModified;
    }

    /**
     * Upstream `_doCreateUntitled` "mark as dirty": a document an extension created reads as dirty even while empty,
     * and the model and its tab stay clean. Holds until the first edit, when the model speaks for itself.
     */
    public markDirtyForExtensions(): void {
        this.markedDirtyForExtensions = true;
        const subscription = this.doc.onDidChangeModelContent(() => {
            this.markedDirtyForExtensions = false;
            // Stryker disable next-line CallExpression: only frees the listener early: the flag is down, a repeat changes nothing
            subscription.dispose();
        });
    }

    public override get isDirtyForExtensions(): boolean {
        return this.markedDirtyForExtensions || this.isModified;
    }

    /**
     * Where a plain save writes without asking (upstream `suggestSavePath`). Deviation: upstream writes a relative
     * `untitled:new.txt` to `/new.txt` and a host form to a UNC path; here both have no path and go to the Save As dialog.
     */
    private get associatedFilePath(): string | null {
        if (!this.hasAssociatedResource || this.uriValue.authority !== "") return null;
        return this.uriValue.path.startsWith("/") ? this.uriValue.path : null;
    }

    /** Upstream `doSaveAsTextFile` asks before writing over a file that appeared after the open: here "conflict" asks. */
    private async saveToAssociatedFile(target: string, overwrite: boolean): Promise<SaveOutcome> {
        if (!overwrite && (await this.files.exists(Uri.file(target)))) return "conflict";
        // Upstream's write creates missing parents; the path came from an extension, nobody has seen it in a dialog.
        await this.files.createFolder(Uri.file(path.dirname(target)));
        await this.saveAs(target);
        return "saved";
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
            this.readIntoMemory(filePath);
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
        this.memoryEnd = null;
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

    /** A document on disk refuses: its text has to stream into memory first, which is {@link enableEditing}. */
    public override forcefullyEnableFeatures(): boolean {
        if (this.isOnDisk) return false;
        return super.forcefullyEnableFeatures();
    }

    /**
     * Upstream's "Forcefully Enable Features" on a document on disk: the file streams into a piece tree chunk by
     * chunk between awaits, with {@link memoryLoading} for the status bar, while the document on disk stays on
     * screen; at the end the model switches to the piece tree in one flush and leaves the mode. A file no string can
     * hold stays on disk: the features being enabled (`getText()` for providers, formatting) could not work on it.
     */
    public override enableEditing(): Promise<EnableEditingRefusal | null> {
        const disk = this.doc.onDisk;
        const filePath = this.filePath;
        // Stryker disable next-line ConditionalExpression: a document on disk always came from a path; the second check is for the type
        if (disk === null || filePath === null) return super.enableEditing();
        if (disk.size > MAX_STRING_LENGTH) return Promise.resolve("too-large");
        this.pendingEnableEditing ??= this.enableEditingFromDisk(filePath).finally(() => {
            this.pendingEnableEditing = null;
        });
        return this.pendingEnableEditing;
    }

    private async enableEditingFromDisk(filePath: string): Promise<EnableEditingRefusal | null> {
        let outcome: StreamOutcome;
        this.streamingForEditing = true;
        try {
            outcome = await this.streamIntoMemory(filePath);
        } finally {
            this.streamingForEditing = false;
        }
        // Stryker disable next-line ConditionalExpression,StringLiteral: a document on disk is read-only, its version never moves, so "modified" cannot come back here; the mapping is for the type
        if (outcome === "modified") return "cancelled";
        if (outcome !== null) return outcome;
        super.forcefullyEnableFeatures();
        this.recheckDiskAfterStream(filePath);
        return null;
    }

    /**
     * Reads the file into a piece tree in chunks of {@link READ_CHUNK_SIZE}, each after an await (`fs.read` in the
     * libuv pool), so frames and keys get the main thread in between; the decoder and the builder take the chunks
     * one by one (A4). The text replaces the document only at the end, in one flush (`setText`, as upstream
     * `updateModel` replaces a reloaded model's text); until then the old text stays. The encoding is sniffed by BOM,
     * like any reload. A newer load, a reload or a dispose cancels this one (`loadGeneration`); an edit made
     * meanwhile wins over the file (`modified`). `null` — the text is in.
     */
    private async streamIntoMemory(filePath: string): Promise<StreamOutcome> {
        // Stryker disable next-line UpdateOperator: see readDiskBytes
        const generation = ++this.loadGeneration;
        const version = this.doc.versionId;
        const stat = this.readDiskStat(filePath);
        const file = this.openRandomAccess(filePath);
        if (file === null) return "read-failed";
        try {
            if (this.memory !== null && file.size * MEMORY_PER_FILE_BYTE > this.memory.availableBytes()) {
                return "out-of-memory";
            }
            const head = Buffer.alloc(BOM_SNIFF_LENGTH);
            const headBytes = head.subarray(0, file.readSync(head, 0));
            const info = resolveDecodeEncoding(headBytes, undefined);
            const decoder = createStreamDecoder(info.id);
            const builder = createTextBufferFactoryBuilder();
            const chunk = Buffer.allocUnsafe(READ_CHUNK_SIZE);
            const bomLength = headBytes.length - stripBOM(headBytes, info).length;
            this.setMemoryLoading(generation, { loadedBytes: 0, totalBytes: file.size });
            // Laid out up front from the size at open (docs/MUTATION.md: a mutant cannot stall the loop). Bytes appended
            // meanwhile are caught by the stat check after the stream.
            let loaded = bomLength;
            for (const offset of chunkOffsets(bomLength, file.size, READ_CHUNK_SIZE)) {
                const read = await file.read(chunk, offset);
                if (generation !== this.loadGeneration) return "cancelled";
                // The file shrank under the stream: what was read is the text; the stat check reloads the rest.
                if (read <= 0) break;
                // The decoder copies the tail it holds back: the scratch buffer can be reused.
                builder.acceptChunk(decoder.write(chunk.subarray(0, read)));
                if (this.memory !== null && this.memory.availableBytes() < MEMORY_RESERVE_BYTES) return "out-of-memory";
                loaded = offset + read;
                this.setMemoryLoading(generation, { loadedBytes: loaded, totalBytes: file.size });
            }
            builder.acceptChunk(decoder.end());
            if (this.doc.versionId !== version) return "modified";
            const factory = builder.finish();
            this.applyEncoding(info.id);
            this.diskStat = stat;
            this.diskConflictValue = false;
            this.setOrphaned(false);
            // The document on disk closes its descriptor here, when the piece tree replaces it. The language stays: the
            // document is the same one, and a language the user picked for it survives.
            this.replaceText(factory);
            // Where the text ends in the file: what was appended during the stream is the append of the stat check
            // after it (follow, 4.4), not a second stream.
            this.memoryEnd = info.iconvName === "utf8" ? readEnd(filePath, loaded) : null;
            return null;
        } catch (error) {
            // A read failure (EIO, a file gone under a network mount) refuses; anything else is a bug.
            if (!isFileSystemError(error)) throw error;
            return generation === this.loadGeneration ? "read-failed" : "cancelled";
        } finally {
            file.dispose();
            this.endMemoryLoading(generation);
        }
    }

    /** `null`: unreadable (EACCES, a directory) — the caller refuses. Anything that is not the file system's surfaces. */
    private openRandomAccess(filePath: string): IRandomAccessFile | null {
        const opener = this.randomAccessFiles;
        // Stryker disable next-line ConditionalExpression: both callers come here only with an opener (a document on disk, or a streamed reload gated on it); the check is for the type
        if (opener === null) return null;
        try {
            return opener.open(filePath);
        } catch (error) {
            if (!isFileSystemError(error)) throw error;
            return null;
        }
    }

    private setMemoryLoading(generation: number, progress: IMemoryLoadingProgress): void {
        this.memoryLoadingState = { generation, progress };
        this.onDidChangeMemoryLoadingEmitter.fire();
    }

    /** A newer load owns the progress by now: an older one ending must not clear it. */
    private endMemoryLoading(generation: number): void {
        if (this.memoryLoadingState?.generation !== generation) return;
        this.memoryLoadingState = null;
        this.onDidChangeMemoryLoadingEmitter.fire();
    }

    /**
     * The file may have changed while it streamed in (a log appended to, 4.4): the stat taken before the stream is
     * the model's, so a difference now is an external change like any other: an append goes into the piece tree
     * ({@link appendInMemory}), anything else reloads the clean buffer.
     */
    private recheckDiskAfterStream(filePath: string): void {
        this.handleExternalFileChange(filePath);
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
     * still above the threshold (a reload never turns the mode on: upstream's "decided once"). A large file in
     * memory (editing enabled) streams in, like "Enable Editing": a synchronous read of 500 MB froze the editor for
     * seconds on every external change. The text is replaced in one flush, not diffed (docs/arch/Editor.md).
     */
    private loadDocumentFromDisk(filePath: string): void {
        if (this.isTooLargeForTokenization && this.openOnDisk(filePath)) return;
        if (this.streamsOnReload(filePath)) {
            void this.reloadStreaming(filePath);
            return;
        }
        this.readIntoMemory(filePath);
    }

    /** Synchronous: the first open needs the built document to decide the mode on it. */
    private readIntoMemory(filePath: string): void {
        this.applyDecoded(filePath, decodeStreamByBOM(this.readDiskChunks(filePath)));
    }

    /** Above the size threshold, with the means to stream (the opener of the document on disk). */
    private streamsOnReload(filePath: string): boolean {
        if (this.randomAccessFiles === null) return false;
        const stat = this.readDiskStat(filePath);
        return stat !== null && isTooLargeForTokenization(stat.size, 0, this.largeFileOptions(this.doc.languageId));
    }

    /**
     * The old text stays editable while the new one streams in. An edit meanwhile, or no memory for a second copy,
     * leaves the buffer as it is, in conflict with the disk: the user decides, as with a dirty buffer.
     */
    private async reloadStreaming(filePath: string): Promise<void> {
        const outcome = await this.streamIntoMemory(filePath);
        if (outcome === null) {
            this.fireDiskStateChange();
        } else if (outcome === "modified" || outcome === "out-of-memory") {
            this.setDiskConflict(true);
        }
    }

    private readDiskChunks(filePath: string): Iterable<Buffer> {
        // Stryker disable next-line UpdateOperator: the generation is only compared for equality, so "--" is a new value too
        this.loadGeneration++;
        return readFileChunks(filePath, (bytes) => {
            this.loadedBytes = bytes;
        });
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
        // The bytes as read, not the stat: the file may have grown since, and those bytes are the next append.
        this.memoryEnd = encoding === "utf8" || encoding === "utf8bom" ? readEnd(filePath, this.loadedBytes) : null;
        mark("textfile:document-built", { lines: this.doc.lineCount });
        // Language goes after the text: on first open a language change moves the tokenizer
        // of an already-built view onto the document with text rather than an empty one.
        this.doc.setLanguage(this.resolveLanguageId(filePath));
    }

    public async save(options?: { overwrite?: boolean }): Promise<SaveOutcome> {
        const filePath = this.filePath;
        const associatedFile = this.associatedFilePath;
        if (associatedFile !== null) return this.saveToAssociatedFile(associatedFile, options?.overwrite === true);
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
        // The snapshot is the saved state: edits typed while the bytes stream to disk stay unsaved.
        const savedVersion = this.doc.versionId;
        const savedEol = this.doc.eol;
        let written: IFileStat;
        try {
            // Streamed: the encoded snapshot goes to the file a megabyte at a time, no buffer of the whole file (A4).
            const bytes = encodeStream(this.doc.createSnapshot(), this.encodingValue);
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
        this.markSaved(savedVersion, savedEol);
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
     * Upstream `revert({ soft: true })`, before the file is deleted: the text stays and is no longer unsaved, so nothing
     * asks to save it and no save brings the file back.
     */
    public revertSoft(): void {
        this.markSaved();
        this.broadcastMarkDirty();
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
        if (this.isOnDisk) {
            await this.copyOnDiskTo(path.resolve(newPath));
            return;
        }
        const previousUri = this.uriValue;
        const previousAssociated = this.hasAssociatedResource;
        this.uriValue = Uri.file(path.resolve(newPath));
        this.hasAssociatedResource = false;
        this.providedWatch?.dispose();
        this.providedWatch = null;
        const participation = this.saveParticipant?.participate(this) ?? null;
        if (participation !== null) await participation;
        const savedVersion = this.doc.versionId;
        const savedEol = this.doc.eol;
        const bytes = encodeStream(this.doc.createSnapshot(), this.encodingValue);
        let written: IFileStat;
        try {
            written = await this.files.writeFile(this.uriValue, bytes, { atomic: true });
        } catch (error) {
            // Nothing was written: the buffer is still what it was, not a file that does not exist.
            this.uriValue = previousUri;
            this.hasAssociatedResource = previousAssociated;
            throw error;
        }
        this.markedDirtyForExtensions = false;
        this.diskStat = { mtimeMs: written.mtime, size: written.size };
        this.doc.setLanguage(this.resolveLanguageId(newPath));
        this.markSaved(savedVersion, savedEol);
        this.setDiskConflict(false);
        this.setOrphaned(false);
        this.startWatchingFile(newPath);
        this.fireSaved();
    }

    /**
     * Save As of a document on disk: its text is the file's bytes (read-only, UTF-8, the file's own EOL), so the copy
     * is the file service's — the kernel copies, nothing passes through memory — and save participants have nothing
     * to edit. The model then reopens on disk at the new path, so that its lines come from the file it names.
     */
    private async copyOnDiskTo(newPath: string): Promise<void> {
        const target = Uri.file(newPath);
        // The same path: the file already is the document.
        if (target.toString() !== this.uriValue.toString()) await this.files.copy(this.uriValue, target, true);
        this.uriValue = target;
        if (!this.openOnDisk(newPath)) this.readIntoMemory(newPath);
        this.markSaved();
        this.setDiskConflict(false);
        this.setOrphaned(false);
        this.startWatchingFile(newPath);
        this.fireSaved();
    }

    private readDiskStat(filePath: string): IDiskStat | null {
        try {
            const stat = fs.statSync(filePath);
            return { mtimeMs: stat.mtimeMs, size: stat.size, ino: stat.ino };
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
        if (this.streamingForEditing || !this.differsFromDisk(current)) return;
        if (this.isModified) {
            this.setDiskConflict(true);
        } else if (this.extendOnDisk(current) || this.appendInMemory(filePath, current)) {
            this.diskStat = current;
        } else {
            this.revertToDisk();
            this.fireDiskStateChange();
        }
    }

    /**
     * Follow (docs/arch/Editor.md, OpenPerformance 4.4): the same file grew, so the document on disk reads the tail
     * and keeps everything before it. Anything else — truncation, a rotated file under the same name (another
     * inode), a rewrite the buffer's tail check catches — re-indexes from scratch like a reload. `false` — not that case.
     */
    private extendOnDisk(current: IDiskStat): boolean {
        const disk = this.doc.onDisk;
        const known = this.diskStat;
        if (disk === null) return false;
        // Stryker disable next-line ConditionalExpression,BooleanLiteral: a document on disk always has its stat (openOnDisk sets it); the check is for the type
        if (known === null) return false;
        if (current.ino !== known.ino || current.size <= known.size) return false;
        return disk.extendTo(current.size);
    }

    /**
     * Follow of a document in memory: the same file grew after the bytes it was read from, which still read the
     * same — the new bytes are decoded and appended to the piece tree, where a reload would read and build the
     * whole file again on every line of a growing log. A split `\r\n` (the old `\r` was a line break already)
     * and a tail of more than a chunk reload; an incomplete UTF-8 sequence at the end waits for the next event.
     */
    private appendInMemory(filePath: string, current: IDiskStat): boolean {
        const end = this.memoryEnd;
        const known = this.diskStat;
        // The document on disk has no end in memory: openOnDisk clears it.
        if (end === null) return false;
        // Stryker disable next-line ConditionalExpression,BooleanLiteral: differsFromDisk let the event through only with a known stat; the check is for the type
        if (known === null) return false;
        if (current.ino !== known.ino || current.size <= end.bytes || current.size - end.bytes > READ_CHUNK_SIZE) {
            return false;
        }
        const from = end.bytes - end.tail.length;
        // Stryker disable next-line ArithmeticOperator: a longer read stops at the end of the file, which is the stat's size unless bytes were written in between
        const read = readRange(filePath, from, current.size - from);
        if (!read.subarray(0, end.tail.length).equals(end.tail)) return false;
        const added = read.subarray(end.tail.length);
        if (end.tail.at(-1) === CR && added[0] === LF) return false;
        const whole = added.subarray(0, completeUtf8Length(added));
        this.appendFromDisk(whole.toString("utf8"));
        const tail = Buffer.concat([end.tail, whole]);
        this.memoryEnd = {
            bytes: end.bytes + whole.length,
            // Stryker disable next-line MethodExpression: keeping the whole tail (at most a chunk) checks more bytes next time, the same verdict
            tail: Buffer.from(tail.subarray(Math.max(0, tail.length - DISK_TAIL_CHECK_BYTES))),
        };
        return true;
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

/** Offsets of the chunks from `start` to `size`: a streamed read is bounded by them, not by a counter. */
function chunkOffsets(start: number, size: number, chunkSize: number): number[] {
    // Stryker disable next-line ArithmeticOperator: "size + start" lays out at most one offset past the end, whose read returns nothing and ends the loop
    const count = Math.max(0, Math.ceil((size - start) / chunkSize));
    return Array.from({ length: count }, (_, index) => start + index * chunkSize);
}

const CR = 0x0d;
const LF = 0x0a;

/** The file is closed at the end of the pass or when the pass is abandoned. No file yields no chunks. */
function* readFileChunks(filePath: string, onEnd: (bytes: number) => void): Generator<Buffer> {
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
    onEnd(bytes);
    mark("textfile:read", { bytes });
}

/** Up to `length` bytes at `position`; fewer when the file is shorter, none when it is gone. */
function readRange(filePath: string, position: number, length: number): Buffer {
    let fd;
    try {
        fd = fs.openSync(filePath, "r");
    } catch {
        return Buffer.alloc(0);
    }
    try {
        const buffer = Buffer.allocUnsafe(length);
        return buffer.subarray(0, fs.readSync(fd, buffer, 0, length, position));
    } finally {
        fs.closeSync(fd);
    }
}

/** The end of a document read from the file: `bytes` and the last of them, for {@link TextFileModel.appendInMemory}. */
function readEnd(filePath: string, bytes: number): { bytes: number; tail: Buffer } {
    const length = Math.min(bytes, DISK_TAIL_CHECK_BYTES);
    return { bytes, tail: readRange(filePath, bytes - length, length) };
}

/** The bytes up to the last whole UTF-8 sequence: an append may end in the middle of a character. */
function completeUtf8Length(bytes: Buffer): number {
    // A lead byte within the last three: its sequence ends past the buffer when it is longer than what is left.
    // Stryker disable next-line MethodExpression: a lead further back starts a sequence of at most four bytes, which ends within the buffer
    for (let i = bytes.length - 1; i >= Math.max(0, bytes.length - 3); i--) {
        const byte = bytes[i];
        if ((byte & 0xc0) === 0x80) continue;
        // Stryker disable next-line EqualityOperator: 0xC0 (and 0xC1) is never a lead in UTF-8, an overlong form; only `byte >= 0xc0` of the three can be one off
        const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
        return i + length > bytes.length ? i : bytes.length;
    }
    return bytes.length;
}

/**
 * An `fs` failure carries an errno code (EACCES, EISDIR, EIO). Node's own argument errors carry `ERR_*` codes and are
 * bugs, like a thrown `TypeError`.
 */
function isFileSystemError(error: unknown): boolean {
    const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
    return /^E[A-Z]+$/.test(String(code));
}
