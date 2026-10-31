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
import {
    type FileOperationKind,
    type IFileOperationPair,
    type IFileOperationParticipant,
    NULL_FILE_OPERATION_PARTICIPANT,
} from "../common/iFileOperationParticipant.ts";
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

/** What one edit has done so far: everything here goes into its single undo step. */
interface IEditStep {
    readonly label: string;
    readonly ops: ReversibleOp[];
    readonly resources: string[];
    /** The edit's own buffers: only these are saved after a refactoring. */
    readonly edited: Map<string, IBulkEditBuffer>;
    /** Buffers edited by file operation participants: in the step, not saved, as upstream. */
    readonly participantEdited: Set<string>;
    /** A failed entry doesn't stop the rest (the explorer), instead of rolling the edit back. */
    readonly tolerant: boolean;
    readonly willDelete?: (target: string) => void;
}

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
        // A text edit brings an untitled resource to life (upstream resolves one from its uri): it starts empty.
        if (filePath.startsWith("untitled:")) {
            // Stryker disable next-line StringLiteral: only the disk branch reads this text, and a foreign resource never gets there
            return Promise.resolve({ text: "", encoding: DEFAULT_PROJECTION_ENCODING });
        }
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

    /** The extension host, once there is one. */
    public fileOperationParticipant: IFileOperationParticipant = NULL_FILE_OPERATION_PARTICIPANT;

    /** The tail of the operations running now, see {@link oneAtATime}. */
    private lastFileOperation: Promise<unknown> = Promise.resolve();

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
        const step = createStep(label, true);
        for (const group of groupFileEdits(edits)) await this.applyFileGroup(group, step);

        if (step.ops.length === 0) return null;

        const element = buildUndoElement(label, step.resources, step.ops);
        // Text edits of a participant put the step into the buckets of their documents too: Ctrl+Z from such a tab
        // undoes it, and the explorer still finds it in its own bucket.
        const participants =
            step.participantEdited.size === 0
                ? []
                : [
                      ...this.buffers.undoParticipants([...step.participantEdited]),
                      { context: WORKSPACE_UNDO_CONTEXT, label, owner: false },
                  ];
        this.undoRedo.pushWorkspaceElement(element, participants);
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

        const step = createStep(label, false, (target) => {
            this.buffers.willDelete(Uri.file(target).toString());
        });
        if (!(await this.applyPlan(plan, step))) return false;

        if (step.ops.length > 0) {
            this.undoRedo.pushWorkspaceElement(
                buildUndoElement(label, step.resources, step.ops),
                this.buffers.undoParticipants([...step.edited.keys(), ...step.participantEdited]),
            );
        }
        if (options?.respectAutoSaveConfig === true) await this.saveRefactoring(plan, step.edited);
        return true;
    }

    /** `false` — a write failed after validation (race, permissions) and what was applied is rolled back. */
    private async applyPlan(plan: readonly PlanEntry[], step: IEditStep): Promise<boolean> {
        try {
            for (let i = 0; i < plan.length; ) {
                const entry = plan[i];
                if (entry.kind === "text") {
                    await this.applyTextSlot(entry.slot, step);
                    i++;
                    continue;
                }
                const group = fileGroupAt(plan, i);
                await this.applyFileGroup(group, step);
                i += group.length;
            }
            return true;
        } catch {
            // A half-applied edit is not allowed.
            for (let i = step.ops.length - 1; i >= 0; i--) await step.ops[i].undo();
            return false;
        }
    }

    /**
     * Upstream `WorkingCopyFileService`: participants, the operation, then one "did" for the whole group. A
     * consecutive run of one kind is one operation (`BulkFileEdits` groups them the same way), and the event carries
     * all of its files.
     */
    private async applyFileGroup(group: readonly ResourceFileEdit[], step: IEditStep): Promise<void> {
        const operation = operationOf(group[0]);
        const planned: IFileOperationPair[] = [];
        for (const edit of group) {
            const pair = await this.plannedPair(edit);
            if (pair !== null) planned.push(pair);
        }
        if (planned.length > 0) await this.runParticipants(operation, planned, step);

        const members: ReversibleOp[] = [];
        const done: IFileOperationPair[] = [];
        await this.oneAtATime(async () => {
            for (const edit of group) {
                try {
                    const pair = await this.applyOne(edit, members, step.resources, step.willDelete);
                    if (pair !== null) done.push(pair);
                } catch (error) {
                    // A failure of one entry doesn't abort the rest (as in pasteFiles).
                    if (step.tolerant) continue;
                    // "Did" was not sent for this group, so its rollback has nothing to reverse.
                    step.ops.push(...members);
                    throw error;
                }
            }
        });
        if (members.length > 0) step.ops.push(this.reportingOp(operation, done, members));
        if (done.length > 0) this.fileOperationParticipant.didRun(operation, done);
    }

    /**
     * Participants let edits overlap for as long as they run. Checking that a target is free and taking it are two
     * steps on the disk: two renames to one target must not both pass the check, or one source is lost.
     */
    private oneAtATime(task: () => Promise<void>): Promise<void> {
        const run = this.lastFileOperation.then(task);
        this.lastFileOperation = run.catch(() => undefined);
        return run;
    }

    /** Undo and redo run the group as one and report it: upstream's reversed operation also fires "did". */
    private reportingOp(
        operation: FileOperationKind,
        files: readonly IFileOperationPair[],
        members: readonly ReversibleOp[],
    ): ReversibleOp {
        const reversed = reverseOperation(operation, files);
        return {
            // One kind in a group: all of its members ask, or none does.
            confirmBeforeUndo: members[0].confirmBeforeUndo,
            undo: async () => {
                for (let i = members.length - 1; i >= 0; i--) await members[i].undo();
                this.fileOperationParticipant.didRun(reversed.operation, reversed.files);
            },
            redo: async () => {
                for (const op of members) await op.redo();
                this.fileOperationParticipant.didRun(operation, files);
            },
        };
    }

    /** A refused or failed edit of a participant doesn't stop the operation, as upstream. */
    private async runParticipants(
        operation: FileOperationKind,
        files: readonly IFileOperationPair[],
        step: IEditStep,
    ): Promise<void> {
        const edit = await this.fileOperationParticipant.willRun(operation, files);
        if (edit === null) return;
        const plan = await this.planWorkspaceEdit(edit);
        // Stryker disable next-line ConditionalExpression: a null plan throws inside applyPlan's try and leaves through the same return below
        if (plan === null) return;
        const nested = createStep(step.label, false, (target) => {
            this.buffers.willDelete(Uri.file(target).toString());
        });
        if (!(await this.applyPlan(plan, nested))) return;
        step.ops.push(...nested.ops);
        step.resources.push(...nested.resources);
        for (const resource of nested.edited.keys()) step.participantEdited.add(resource);
        for (const resource of nested.participantEdited) step.participantEdited.add(resource);
    }

    /** What the event promises; a move or a copy picks its target now, the same way {@link applyOne} will. */
    private async plannedPair(edit: ResourceFileEdit): Promise<IFileOperationPair | null> {
        switch (edit.kind) {
            case "create":
                return pairOf(edit.to);
            case "delete":
                return pairOf(edit.from);
            case "rename":
                return pairOf(edit.to, edit.from);
            case "move":
                if (path.dirname(edit.from) === edit.to) return null;
                return pairOf(
                    await resolveNonConflictingDest(this.files, edit.to, path.basename(edit.from)),
                    edit.from,
                );
            case "copy":
                return pairOf(
                    await resolveNonConflictingDest(this.files, edit.to, path.basename(edit.from)),
                    edit.from,
                );
            default:
                // A kind that bypassed the types: `applyOne` refuses it.
                return null;
        }
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

    private async applyTextSlot(slot: ITextSlot, step: IEditStep): Promise<void> {
        const { label, ops, resources, edited } = step;
        // Looked up now, not in the plan: an earlier operation of this edit may have moved or replaced the model.
        const buffer = this.buffers.get(slot.resource) ?? this.buffers.open(slot.resource);
        // Stryker disable next-line ConditionalExpression,StringLiteral,CallExpression: without the guard `applyEdits` of a string throws instead, and any throw here rolls the edit back the same way; the catch drops the message
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
        // Stryker disable next-line ConditionalExpression,StringLiteral,CallExpression: the plan refuses a foreign resource without a buffer, so this only narrows the type; the catch drops the message
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

    /**
     * `willDelete`: what a workspace edit does to unsaved edits of a file it removes, as upstream. The explorer passes
     * nothing: there a dirty tab outlives its file, struck through. Returns what really happened, for the "did" event;
     * `null` — nothing did (a move within its own directory).
     */
    private async applyOne(
        edit: ResourceFileEdit,
        ops: ReversibleOp[],
        resources: string[],
        willDelete?: (target: string) => void,
    ): Promise<IFileOperationPair | null> {
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
            const moved = current !== from;
            resources.push(from, current);
            ops.push({
                undo: async () => {
                    current = await moveBack(files, current, from);
                },
                redo: async () => {
                    current = await moveInto(files, current, toDir);
                },
            });
            return moved ? pairOf(current, from) : null;
        } else if (edit.kind === "rename") {
            // `to` is an exact path, not a directory. Only `overwrite` may replace what is there, the overwritten
            // contents are restored on undo. Without it, a target taken since validation (participants may have run
            // for a minute) refuses the move, as upstream's `FILE_MOVE_CONFLICT`.
            const from = edit.from;
            const to = edit.to;
            const overwrite = edit.overwrite === true;
            const replaced = await keepAside(files, to);
            await files.createFolder(Uri.file(path.dirname(to)));
            await files.move(Uri.file(from), Uri.file(to), overwrite);
            if (replaced !== null) this.buffers.didReplaceOnDisk(Uri.file(to).toString());
            let current = to;
            resources.push(from, to);
            ops.push({
                undo: async () => {
                    current = await moveBack(files, current, from);
                    await replaced?.restore();
                },
                redo: async () => {
                    await files.move(Uri.file(current), Uri.file(to), overwrite);
                    current = to;
                },
            });
            return pairOf(to, from);
        } else if (edit.kind === "copy") {
            const from = edit.from;
            const toDir = edit.to;
            let created = await copyInto(files, from, toDir);
            const firstCopy = created;
            resources.push(created);
            ops.push({
                confirmBeforeUndo: `Are you sure you want to delete '${path.basename(created)}'?`,
                undo: () => removeIfExists(files, created),
                redo: async () => {
                    created = await copyInto(files, from, toDir);
                },
            });
            return pairOf(firstCopy, from);
        } else if (edit.kind === "delete") {
            const from = edit.from;
            resources.push(from);
            if (this.willMoveToTrash()) {
                // Trash bypasses the file service: we notify the tabs of the deleted
                // resource ourselves (for a permanent delete the service does it).
                const trash = async (): Promise<ITrashEntry> => {
                    willDelete?.(from);
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
                willDelete?.(from);
                await removeIfExists(files, from);
            }
            return pairOf(from);
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
            // Stryker disable next-line ConditionalExpression,StringLiteral: the file service writes a string as the same UTF-8 bytes, the encoding only satisfies the type
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
                    willDelete?.(createdRoot);
                    await removeIfExists(files, createdRoot);
                    await replaced?.restore();
                },
                redo: doCreate,
            });
            return pairOf(to);
        }
    }
}

function createStep(label: string, tolerant: boolean, willDelete?: (target: string) => void): IEditStep {
    return {
        label,
        ops: [],
        resources: [],
        edited: new Map(),
        participantEdited: new Set(),
        tolerant,
        willDelete,
    };
}

function pairOf(target: string, source?: string): IFileOperationPair {
    return {
        ...(source === undefined ? {} : { source: Uri.file(source).toString() }),
        target: Uri.file(target).toString(),
    };
}

function operationOf(edit: ResourceFileEdit): FileOperationKind {
    return edit.kind === "rename" ? "move" : edit.kind;
}

/** Runs of one operation; a rename and an explorer move are the same one. */
function groupFileEdits(edits: readonly ResourceFileEdit[]): ResourceFileEdit[][] {
    const groups: ResourceFileEdit[][] = [];
    for (const edit of edits) {
        const last = groups.at(-1);
        if (last !== undefined && operationOf(last[0]) === operationOf(edit)) last.push(edit);
        else groups.push([edit]);
    }
    return groups;
}

/** The run of file entries of one operation that starts at `start`. */
function fileGroupAt(plan: readonly PlanEntry[], start: number): ResourceFileEdit[] {
    const entries: ResourceFileEdit[] = [];
    for (let i = start; i < plan.length; i++) {
        const entry = plan[i];
        if (entry.kind !== "file") break;
        entries.push(entry.edit);
    }
    return groupFileEdits(entries)[0];
}

/** Upstream's undo of a create is a delete, and so on. */
function reverseOperation(
    operation: FileOperationKind,
    files: readonly IFileOperationPair[],
): { readonly operation: FileOperationKind; readonly files: readonly IFileOperationPair[] } {
    if (operation === "move") {
        return {
            operation,
            files: files.map((pair) => ({ source: pair.target, target: pair.source ?? pair.target })),
        };
    }
    const targets = files.map((pair) => ({ target: pair.target }));
    return { operation: operation === "delete" ? "create" : "delete", files: targets };
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
    // A no-op ({@link skipsFileEdit}), not a collision.
    if (renamesOntoItself(edit)) return true;
    if (!(await projection.exists(edit.to))) return true;
    // An occupied target without explicit permission — the edit is not applied.
    return edit.overwrite === true || skipsOccupiedTarget(edit);
}

function renamesOntoItself(edit: WorkspaceFileEdit): boolean {
    // Stryker disable next-line ConditionalExpression: only a rename reaches here with a `from`, for a create `from === to` is false anyway
    return edit.kind === "rename" && edit.from === edit.to;
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
    if (renamesOntoItself(edit)) return true;
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
