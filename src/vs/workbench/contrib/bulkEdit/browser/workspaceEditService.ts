import * as path from "node:path";

import { Uri } from "../../../../base/common/uri.ts";
import type { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import { clampPositionToDocument } from "../../../../editor/common/core/iPosition.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { createTextEdit, hasOverlappingEdits } from "../../../../editor/common/core/iTextEdit.ts";
import { decodeBufferByBOM, encodeText, type IDecodedText } from "../../../../editor/common/model/encoding.ts";
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import {
    FileOperationResult,
    type IFileService,
    IFileServiceDIToken,
    isFileOperationError,
} from "../../../../platform/files/common/files.ts";
import {
    type ITrashEntry,
    type ITrashService,
    ITrashServiceDIToken,
} from "../../../../platform/files/common/iTrashService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IUndoRedoElement } from "../../../../platform/undoRedo/common/iUndoRedoElement.ts";
import {
    UndoRedoService,
    UndoRedoServiceDIToken,
    WORKSPACE_UNDO_CONTEXT,
} from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { IBulkEditBuffer, IBulkEditBuffers } from "../common/iBulkEditBuffers.ts";
import { IBulkEditBuffersDIToken } from "../common/iBulkEditBuffers.ts";
import type { BulkEdit, ResourceFileEdit, WorkspaceFileEdit } from "../common/workspaceEdit.ts";
import { isResourceFileEdit } from "../common/workspaceEdit.ts";

interface ReversibleOp {
    undo(): void | Promise<void>;
    redo(): void | Promise<void>;
    /** See {@link IUndoRedoElement.canUndo}: a refusal of one operation cancels the whole step. */
    canUndo?(): boolean | Promise<boolean>;
    canRedo?(): boolean | Promise<boolean>;
    confirmBeforeUndo?: string;
}

/**
 * Edits of ONE resource in the coordinates of its text at this point of the edit (`vscode.WorkspaceEdit` semantics:
 * they don't shift each other and don't overlap), so they are collected and applied as one batch. A file operation
 * ends the batch: the edits after it are another slot, as in upstream's grouping by edit type.
 */
interface ITextSlot {
    /** `uri.toString()`. */
    readonly resource: string;
    /** `null` — untitled buffer. */
    readonly filePath: string | null;
    /** Before the edits — coordinates are clamped against it. */
    readonly base: string;
    /** Used only when the edit goes to disk past any model. */
    readonly encoding: string;
    /**
     * The file appeared in this same edit: before the step is redone it doesn't exist yet — the step's
     * file operation that precedes the edit brings it back.
     */
    readonly bornInEdit: boolean;
    readonly edits: ITextEdit[];
    setEndOfLine?: EndOfLine;
}

/** In the order the extension sent the operations. */
type PlanEntry =
    | { readonly kind: "file"; readonly edit: WorkspaceFileEdit }
    | { readonly kind: "text"; readonly slot: ITextSlot };

/**
 * "What the resource will hold by the time of the operation": without it "create a file and write to it right away"
 * can't be validated. The key is a path for a file, `uri.toString()` for anything else.
 */
class ResourceProjection {
    public constructor(
        private readonly files: IFileService,
        /** The text of an open model: it wins over the disk, unsaved edits included. */
        private readonly liveText: (key: string) => string | null,
    ) {}

    /** `null` — "the resource won't exist"; keys not here were not touched by the edit. */
    private readonly state = new Map<string, string | null>();
    private readonly born = new Set<string>();

    public exists(filePath: string): Promise<boolean> {
        const known = this.state.get(filePath);
        if (known === undefined) return this.files.exists(Uri.file(filePath));
        return Promise.resolve(known !== null);
    }

    /** `null` — no file. */
    public read(filePath: string): Promise<{ text: string; encoding: string } | null> {
        const known = this.state.get(filePath);
        if (known === null) return Promise.resolve(null);
        if (known !== undefined) return Promise.resolve({ text: known, encoding: DEFAULT_PROJECTION_ENCODING });
        const live = this.liveText(filePath);
        if (live !== null) return Promise.resolve({ text: live, encoding: DEFAULT_PROJECTION_ENCODING });
        // Not a path: nothing on disk answers for a foreign scheme.
        return path.isAbsolute(filePath) ? readTextFile(this.files, filePath) : Promise.resolve(null);
    }

    public knows(filePath: string): boolean {
        return this.state.has(filePath);
    }

    public isBorn(filePath: string): boolean {
        return this.born.has(filePath);
    }

    public createFile(filePath: string, contents: string): void {
        this.state.set(filePath, contents);
        this.born.add(filePath);
    }

    /** The text after an earlier batch of edits of this same workspace edit. */
    public setText(key: string, text: string): void {
        this.state.set(key, text);
    }

    public remove(filePath: string): void {
        this.state.set(filePath, null);
    }

    public async rename(from: string, to: string): Promise<void> {
        const kept = await this.read(from);
        this.remove(from);
        // A directory is projected as empty: an edit on the new path hits the FS anyway, not the projection.
        // Stryker disable next-line StringLiteral: the contents of such a projection source are unknown — any value is equally unobservable
        this.state.set(to, kept === null ? "" : kept.text);
        this.born.add(to);
    }
}

/** File created by the edit itself: contents came as a string, there was no byte representation. */
const DEFAULT_PROJECTION_ENCODING = "utf8";

/**
 * {@link applyFileEdits} (explorer): a failure of one entry doesn't abort the rest. {@link applyWorkspaceEdit}:
 * all-or-nothing and ONE undo step for the whole edit. Delete goes to the trash if available (then
 * undoable), otherwise permanently and bypassing history.
 */
export class WorkspaceEditService {
    public static readonly dependencies = [
        UndoRedoServiceDIToken,
        ITrashServiceDIToken,
        IConfigurationServiceDIToken,
        IBulkEditBuffersDIToken,
        IFileServiceDIToken,
    ] as const;

    private readonly undoRedo: UndoRedoService;
    private readonly trash: ITrashService;
    private readonly config: IConfigurationService;
    private readonly buffers: IBulkEditBuffers;

    public constructor(
        undoRedo: UndoRedoService,
        trash: ITrashService,
        config: IConfigurationService,
        buffers: IBulkEditBuffers,
        private readonly files: IFileService,
    ) {
        this.undoRedo = undoRedo;
        this.trash = trash;
        this.config = config;
        this.buffers = buffers;
    }

    public willMoveToTrash(): boolean {
        const enabled = this.config.get("files.enableTrash");
        return enabled && this.trash.isAvailable();
    }

    /** `null` — no operation is undoable (e.g. only a permanent delete). */
    public async applyFileEdits(edits: readonly ResourceFileEdit[], label: string): Promise<IUndoRedoElement | null> {
        const ops: ReversibleOp[] = [];
        const resources: string[] = [];

        for (const edit of edits) {
            try {
                await this.applyOne(edit, ops, resources);
            } catch {
                // A failure of one entry doesn't abort the rest (as in pasteFiles).
            }
        }

        if (ops.length === 0) return null;

        const element = buildUndoElement(label, resources, ops);
        this.undoRedo.pushElement(element, WORKSPACE_UNDO_CONTEXT);
        return element;
    }

    /**
     * `false` — NOTHING was applied: the whole edit is validated before applying, since the extension's `applyEdit()`
     * resolves with this value. A resource is edited through its model and stays dirty, as in VS Code, whether or not
     * it has a tab: a closed one gets a live model, and the file changes only on save.
     */
    public async applyWorkspaceEdit(
        edits: BulkEdit,
        label: string,
        options?: { respectAutoSaveConfig?: boolean },
    ): Promise<boolean> {
        // Empty list: the caller answers for the vacuous success, nothing is applied here.
        if (edits.length === 0) return false;
        // An empty plan (all operations are legitimate no-ops) is NOT a refusal; only `null` is.
        const plan = await this.planWorkspaceEdit(edits);
        if (plan === null) return false;

        const ops: ReversibleOp[] = [];
        const resources: string[] = [];
        const edited = new Map<string, IBulkEditBuffer>();
        for (const entry of plan) {
            try {
                await this.applyPlanEntry(entry, label, ops, resources, edited);
            } catch {
                // Write failure after validation (race, permissions): roll back what was applied — a half-applied edit is not allowed.
                for (let i = ops.length - 1; i >= 0; i--) await ops[i].undo();
                return false;
            }
        }

        if (ops.length > 0) {
            this.undoRedo.pushWorkspaceElement(
                buildUndoElement(label, resources, ops),
                this.buffers.undoParticipants([...edited.keys()]),
            );
        }
        if (options?.respectAutoSaveConfig === true) await this.saveRefactoring(plan, edited);
        return true;
    }

    /**
     * Upstream: `BulkEditService._saveAll`. Without saving the buffers, "Move to a new file" would leave the new
     * file on disk and the source only in the buffer.
     */
    private async saveRefactoring(
        plan: readonly PlanEntry[],
        edited: ReadonlyMap<string, IBulkEditBuffer>,
    ): Promise<void> {
        if (!this.config.get("files.refactoring.autoSave")) return;
        if (touchedResources(plan).size <= 1) return;
        await Promise.allSettled([...edited.values()].map((buffer) => buffer.save()));
    }

    /** `null` — the whole edit is rejected. */
    private async planWorkspaceEdit(edits: BulkEdit): Promise<PlanEntry[] | null> {
        const plan: PlanEntry[] = [];
        const projection = new ResourceProjection(this.files, (key) => this.liveTextOf(key));
        let slots = new Map<string, ITextSlot>();

        for (const edit of edits) {
            if (isResourceFileEdit(edit)) {
                for (const slot of slots.values()) {
                    projection.setText(slotKey(slot), applyEditsToText(slot.base, slot.edits, slot.setEndOfLine));
                }
                slots = new Map();
                if (!(await validateFileEdit(edit, projection))) return null;
                if (await skipsFileEdit(edit, projection)) continue;
                await projectFileEdit(edit, projection);
                plan.push({ kind: "file", edit });
                continue;
            }

            if (edit.edits.length === 0 && edit.setEndOfLine === undefined) continue;
            const known = slots.get(edit.resource);
            let slot: ITextSlot;
            if (known === undefined) {
                const opened = await this.openTextSlot(edit.resource, projection);
                if (opened === null) return null;
                slot = opened;
                slots.set(edit.resource, slot);
                plan.push({ kind: "text", slot });
            } else {
                slot = known;
            }
            if (edit.setEndOfLine !== undefined) slot.setEndOfLine = edit.setEndOfLine;
            const doc = new TextDocument(slot.base);
            for (const item of edit.edits) {
                const start = clampPositionToDocument(doc, item.range.start);
                const end = clampPositionToDocument(doc, item.range.end);
                slot.edits.push(
                    createTextEdit(createRange(start.line, start.character, end.line, end.character), item.text),
                );
            }
            // The document would apply overlapping edits to already consumed text —
            // corrupted contents and a broken undo.
            if (hasOverlappingEdits(slot.edits)) return null;
        }

        return plan;
    }

    private liveTextOf(key: string): string | null {
        const target = this.buffers.get(path.isAbsolute(key) ? Uri.file(key).toString() : key);
        return target === null || target === "read-only" ? null : target.text();
    }

    private async openTextSlot(resource: string, projection: ResourceProjection): Promise<ITextSlot | null> {
        const uri = Uri.parse(resource);
        // Gate on the SCHEME, not the derived path: a foreign uri can have a valid path (`probe:/etc/x`),
        // and the edit would go to an unrelated file.
        const filePath = uri.scheme === "file" ? uri.fsPath : null;
        const key = filePath ?? resource;
        if (!projection.knows(key) && this.buffers.get(resource) === "read-only") return null;
        const source = await projection.read(key);
        if (source === null) return null;
        return {
            resource,
            filePath,
            base: source.text,
            encoding: source.encoding,
            bornInEdit: projection.isBorn(key),
            edits: [],
        };
    }

    private async applyPlanEntry(
        entry: PlanEntry,
        label: string,
        ops: ReversibleOp[],
        resources: string[],
        edited: Map<string, IBulkEditBuffer>,
    ): Promise<void> {
        if (entry.kind === "file") {
            await this.applyOne(entry.edit, ops, resources);
            return;
        }
        const slot = entry.slot;
        // Looked up now, not in the plan: an earlier operation of this edit may have moved or replaced the model.
        const buffer = this.buffers.get(slot.resource) ?? this.buffers.open(slot.resource);
        if (buffer === "read-only") throw new Error(`Read-only resource: ${slot.resource}`);
        if (buffer !== null) {
            if (slot.filePath !== null) resources.push(slot.filePath);
            edited.set(slot.resource, buffer);
            const step = slot.edits.length === 0 ? null : buffer.applyEdits(slot.edits, label);
            // `null` — the edits changed nothing; this is not a refusal.
            if (step !== null) ops.push(step);
            const eolStep = slot.setEndOfLine === undefined ? null : buffer.setEol(slot.setEndOfLine);
            if (eolStep !== null) ops.push(eolStep);
            return;
        }
        const filePath = slot.filePath;
        if (filePath === null) throw new Error(`No buffer for ${slot.resource}`);
        resources.push(filePath);
        const before = slot.base;
        const after = applyEditsToText(before, slot.edits, slot.setEndOfLine);
        const encoding = slot.encoding;
        const bornInEdit = slot.bornInEdit;
        const files = this.files;
        await writeTextFile(files, filePath, after, encoding);
        ops.push({
            // The file was changed externally — undoing would overwrite someone else's edit.
            canUndo: async () => (await readTextFile(files, filePath))?.text === after,
            canRedo: async () => {
                const current = await readTextFile(files, filePath);
                return current === null ? bornInEdit : current.text === before;
            },
            undo: () => writeTextFile(files, filePath, before, encoding),
            redo: () => writeTextFile(files, filePath, after, encoding),
        });
    }

    private async applyOne(edit: ResourceFileEdit, ops: ReversibleOp[], resources: string[]): Promise<void> {
        const files = this.files;
        // Guard against a value that bypassed the types (kind is typed as string on purpose,
        // so the check isn't considered "always true" and stays meaningful at runtime).
        const kind: string = edit.kind;
        if (kind !== "move" && kind !== "rename" && kind !== "copy" && kind !== "delete" && kind !== "create") {
            throw new Error(`Unsupported edit kind: ${kind}`);
        }

        if (edit.kind === "move") {
            const from = edit.from;
            const toDir = edit.to;
            let current = await moveInto(files, from, toDir);
            resources.push(from, current);
            ops.push({
                undo: async () => {
                    current = await moveBack(files, current, from);
                },
                redo: async () => {
                    current = await moveInto(files, current, toDir);
                },
            });
        } else if (edit.kind === "rename") {
            // `to` is an exact path, not a directory. The prompt rules out a collision; for `workspace.applyEdit` it is
            // resolved by `overwrite` — the overwritten contents must be restored on undo.
            const from = edit.from;
            const to = edit.to;
            // Always snapshot the target: if it was taken in a race, undo restores its contents.
            const replaced = await keepAside(files, to);
            await files.createFolder(Uri.file(path.dirname(to)));
            await moveToPath(files, from, to);
            if (replaced !== null) this.buffers.didReplaceOnDisk(Uri.file(to).toString());
            let current = to;
            resources.push(from, to);
            ops.push({
                undo: async () => {
                    current = await moveBack(files, current, from);
                    await replaced?.restore();
                },
                redo: async () => {
                    await moveToPath(files, current, to);
                    current = to;
                },
            });
        } else if (edit.kind === "copy") {
            const from = edit.from;
            const toDir = edit.to;
            let created = await copyInto(files, from, toDir);
            resources.push(created);
            ops.push({
                confirmBeforeUndo: `Are you sure you want to delete '${path.basename(created)}'?`,
                undo: () => removeIfExists(files, created),
                redo: async () => {
                    created = await copyInto(files, from, toDir);
                },
            });
        } else if (edit.kind === "delete") {
            const from = edit.from;
            resources.push(from);
            if (this.willMoveToTrash()) {
                // Trash bypasses the file service: we notify the tabs of the deleted
                // resource ourselves (for a permanent delete the service does it).
                const trash = async (): Promise<ITrashEntry> => {
                    this.buffers.willDelete(Uri.file(from).toString());
                    const trashed = await this.trash.trash(from);
                    this.buffers.didDelete(Uri.file(from).toString());
                    return trashed;
                };
                let entry = await trash();
                ops.push({
                    undo: async () => {
                        await this.trash.restore(entry);
                    },
                    redo: async () => {
                        entry = await trash();
                    },
                });
            } else {
                // Permanent — can't be undone, no history step.
                this.buffers.willDelete(Uri.file(from).toString());
                await removeIfExists(files, from);
            }
        } else {
            const to = edit.to;
            // Collision with an explicit name is an error (per-edit try/catch → no-op); the prompt's validation guards against it.
            const replaced = edit.overwrite === true ? await keepAside(files, to) : null;
            // Stryker disable next-line StringLiteral: the error text is swallowed by the caller's per-edit try/catch — only the refusal itself is observable
            if (replaced === null && (await files.exists(Uri.file(to)))) throw new Error(`File already exists: ${to}`);

            // The topmost of the created ancestors — so undo removes exactly what
            // create added (and doesn't touch directories that already existed).
            const createdRoot = await shallowestMissingAncestor(files, to);
            const contents = edit.contents ?? "";
            const bytes = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
            const doCreate = async (): Promise<void> => {
                await files.createFolder(Uri.file(path.dirname(to)));
                if (edit.directory) await files.createFolder(Uri.file(to));
                else await files.writeFile(Uri.file(to), bytes);
            };
            await doCreate();
            if (replaced !== null) this.buffers.didReplaceOnDisk(Uri.file(to).toString());
            resources.push(to);
            ops.push({
                undo: async () => {
                    // Undoing the edits of this step left the model of the new file dirty, and the file is going away.
                    this.buffers.willDelete(Uri.file(createdRoot).toString());
                    await removeIfExists(files, createdRoot);
                    await replaced?.restore();
                },
                redo: doCreate,
            });
        }
    }
}

/**
 * A refusal of any is a refusal of all. Synchronous as long as all answers are: Ctrl+Z on an edit of only open
 * buffers undoes them before returning. A promise only if someone asks the disk.
 */
function allAllow(answers: readonly (boolean | Promise<boolean> | undefined)[]): boolean | Promise<boolean> {
    if (answers.some((answer) => answer instanceof Promise)) {
        return Promise.all(answers.map((answer) => Promise.resolve(answer))).then((all) =>
            all.every((can) => can !== false),
        );
    }
    return answers.every((can) => can !== false);
}

/** Undo runs in reverse order. */
function buildUndoElement(label: string, resources: readonly string[], ops: readonly ReversibleOp[]): IUndoRedoElement {
    const confirmBeforeUndo = ops.map((o) => o.confirmBeforeUndo).find((m): m is string => m !== undefined);
    return {
        label,
        resources,
        ...(confirmBeforeUndo ? { confirmBeforeUndo } : {}),
        // A refusal of ANY operation cancels the whole step: undoing half (an edit
        // of one file out of three) is worse than undoing nothing.
        canUndo: () => allAllow(ops.map((op) => op.canUndo?.())),
        canRedo: () => allAllow(ops.map((op) => op.canRedo?.())),
        async undo() {
            for (let i = ops.length - 1; i >= 0; i--) await ops[i].undo();
        },
        async redo() {
            for (const op of ops) await op.redo();
        },
    };
}

function slotKey(slot: ITextSlot): string {
    return slot.filePath ?? slot.resource;
}

/** Original coordinates, no overlaps. */
function applyEditsToText(text: string, edits: readonly ITextEdit[], setEndOfLine?: EndOfLine): string {
    const doc = new TextDocument(text);
    doc.applyEdits(edits);
    if (setEndOfLine !== undefined) doc.setEol(setEndOfLine);
    return doc.serialize();
}

async function readTextFile(files: IFileService, filePath: string): Promise<IDecodedText | null> {
    try {
        return decodeBufferByBOM(Buffer.from((await files.readFile(Uri.file(filePath))).value));
    } catch {
        return null;
    }
}

async function writeTextFile(files: IFileService, filePath: string, text: string, encoding: string): Promise<void> {
    await files.writeFile(Uri.file(filePath), await encodeText(text, encoding));
}

async function removeIfExists(files: IFileService, target: string): Promise<void> {
    try {
        await files.del(Uri.file(target), { recursive: true });
    } catch (e) {
        if (!isFileOperationError(e, FileOperationResult.NotFound)) throw e;
    }
}

/**
 * A directory in place of the target needs no separate check: `keepAside` won't read it, and applying
 * is rejected by the "already exists" guard.
 */
async function validateFileEdit(edit: WorkspaceFileEdit, projection: ResourceProjection): Promise<boolean> {
    if (edit.kind === "delete") {
        return (await projection.exists(edit.from)) || edit.ignoreIfNotExists === true;
    }
    if (edit.kind === "rename" && !(await projection.exists(edit.from))) return false;
    // A rename onto itself is a no-op ({@link skipsFileEdit}), not a collision.
    if (edit.kind === "rename" && edit.from === edit.to) return true;
    if (!(await projection.exists(edit.to))) return true;
    // An occupied target without explicit permission — the edit is not applied.
    return edit.overwrite === true || skipsOccupiedTarget(edit);
}

/** Upstream `bulkFileEdits`: only with `overwrite` not given at all; an explicit `false` is a collision. */
function skipsOccupiedTarget(edit: { readonly overwrite?: boolean; readonly ignoreIfExists?: boolean }): boolean {
    return edit.overwrite === undefined && edit.ignoreIfExists === true;
}

/**
 * Called AFTER {@link validateFileEdit}, so it only distinguishes `overwrite` and `ignoreIfExists`:
 * `overwrite` beats `ignoreIfExists` (as in the vscode API) — with it the operation overwrites the target.
 */
async function skipsFileEdit(edit: WorkspaceFileEdit, projection: ResourceProjection): Promise<boolean> {
    if (edit.kind === "delete") return !(await projection.exists(edit.from));
    if (edit.kind === "rename" && edit.from === edit.to) return true;
    return skipsOccupiedTarget(edit) && (await projection.exists(edit.to));
}

async function projectFileEdit(edit: WorkspaceFileEdit, projection: ResourceProjection): Promise<void> {
    if (edit.kind === "create") {
        const contents = edit.contents ?? "";
        projection.createFile(edit.to, typeof contents === "string" ? contents : new TextDecoder().decode(contents));
        return;
    }
    // Stryker disable next-line ConditionalExpression: `true` sends delete into this branch too, and `rename` starts with `remove(from)` — nobody reads the write to a nonexistent path, no observable difference
    if (edit.kind === "rename") {
        await projection.rename(edit.from, edit.to);
        return;
    }
    projection.remove(edit.from);
}

function touchedResources(plan: readonly PlanEntry[]): Set<string> {
    const touched = new Set<string>();
    for (const entry of plan) {
        if (entry.kind === "text") {
            touched.add(entry.slot.resource);
            continue;
        }
        for (const filePath of fileEditPaths(entry.edit)) touched.add(Uri.file(filePath).toString());
    }
    return touched;
}

function fileEditPaths(edit: WorkspaceFileEdit): string[] {
    return edit.kind === "rename" ? [edit.from, edit.to] : [edit.kind === "delete" ? edit.from : edit.to];
}

/** The file itself is left alone — writing and renaming replace the target on their own. `null` — no target or it's not a file. */
async function keepAside(files: IFileService, target: string): Promise<{ restore(): Promise<void> } | null> {
    const kept = await readTextFile(files, target);
    if (kept === null) return null;
    return {
        restore: () => writeTextFile(files, target, kept.text, kept.encoding),
    };
}

async function shallowestMissingAncestor(files: IFileService, target: string): Promise<string> {
    let current = target;
    let parent = path.dirname(current);
    // Stryker disable next-line ConditionalExpression: stopping at the root is a safeguard against an infinite loop; the disk provider's root always exists, and the loop ends earlier
    while (parent !== current && !(await files.exists(Uri.file(parent)))) {
        current = parent;
        parent = path.dirname(current);
    }
    return current;
}

async function moveBack(files: IFileService, src: string, originalPath: string): Promise<string> {
    const dest = await resolveNonConflictingDest(files, path.dirname(originalPath), path.basename(originalPath));
    await moveToPath(files, src, dest);
    return dest;
}

/** Like VS Code/Finder: `name` → `name copy` → `name copy 2` → …, the file extension is kept. */
async function resolveNonConflictingDest(files: IFileService, targetDir: string, name: string): Promise<string> {
    const direct = path.join(targetDir, name);
    if (!(await files.exists(Uri.file(direct)))) return direct;

    const ext = path.extname(name);
    const base = ext ? name.slice(0, -ext.length) : name;

    for (let i = 1; ; i++) {
        const suffix = i === 1 ? " copy" : ` copy ${String(i)}`;
        const candidate = path.join(targetDir, `${base}${suffix}${ext}`);
        if (!(await files.exists(Uri.file(candidate)))) return candidate;
    }
}

async function moveToPath(files: IFileService, src: string, dest: string): Promise<void> {
    await files.move(Uri.file(src), Uri.file(dest), true);
}

/** The provider won't let a directory into itself (OS refusal) — no separate check needed. */
async function copyInto(files: IFileService, src: string, targetDir: string): Promise<string> {
    const dest = await resolveNonConflictingDest(files, targetDir, path.basename(src));
    await files.copy(Uri.file(src), Uri.file(dest));
    return dest;
}

async function moveInto(files: IFileService, src: string, targetDir: string): Promise<string> {
    if (path.dirname(src) === targetDir) return src;

    const dest = await resolveNonConflictingDest(files, targetDir, path.basename(src));
    await moveToPath(files, src, dest);
    return dest;
}

export const WorkspaceEditServiceDIToken = token<WorkspaceEditService>("WorkspaceEditService");
