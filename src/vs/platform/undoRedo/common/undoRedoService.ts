import { Emitter, type Event } from "../../../base/common/event.ts";
import { token } from "../../instantiation/common/diContainer.ts";

import type { IUndoRedoElement } from "./iUndoRedoElement.ts";

export const WORKSPACE_UNDO_CONTEXT = "workspace";

export interface IUndoParticipant {
    readonly context: string;
    readonly label: string;
    /** The step edits this bucket's buffer: losing such a bucket breaks the step, losing one without an edit doesn't. */
    readonly owner: boolean;
}

export type UndoClearReason = "closed" | "replaced";

export interface IUndoRefusal {
    readonly element: IUndoRedoElement;
    readonly message: string;
}

interface WorkspaceElementState {
    /** Push order: steps enter the bucket of a file opened later in this order. */
    readonly order: number;
    readonly participants: Map<string, IUndoParticipant>;
    /** Lost buckets that held the step's edit; non-empty means the step is broken. */
    readonly removed: Map<string, UndoClearReason>;
}

/**
 * History is split into buckets: an opaque editor key (`TextFileModel.undoContext`)
 * or {@link WORKSPACE_UNDO_CONTEXT}. The key is not a path: paths broke on untitled buffers
 * (they shared one bucket) and on `saveAs` (the history got orphaned).
 *
 * A multi-document step sits in the buckets of all participants, like upstream's workspace element,
 * and is undone only when it is on top in all of them. Deviation from upstream (a human decision):
 * the step is never split per file, so there is no "Undo in N Files / Undo this File".
 */
export class UndoRedoService {
    private undoStacks = new Map<string, IUndoRedoElement[]>();
    private redoStacks = new Map<string, IUndoRedoElement[]>();
    private readonly workspaceElements = new WeakMap<IUndoRedoElement, WorkspaceElementState>();
    private nextOrder = 0;

    private readonly onDidRefuseEmitter = new Emitter<IUndoRefusal>();
    public readonly onDidRefuse: Event<IUndoRefusal> = this.onDidRefuseEmitter.event;

    private stack(map: Map<string, IUndoRedoElement[]>, context: string): IUndoRedoElement[] {
        let stack = map.get(context);
        if (!stack) {
            stack = [];
            map.set(context, stack);
        }
        return stack;
    }

    public pushElement(element: IUndoRedoElement, context: string): void {
        this.stack(this.undoStacks, context).push(element);
        this.truncateRedo(context);
    }

    /** Without participants the step goes to the {@link WORKSPACE_UNDO_CONTEXT} bucket. */
    public pushWorkspaceElement(element: IUndoRedoElement, participants: readonly IUndoParticipant[]): void {
        if (participants.length === 0) {
            this.pushElement(element, WORKSPACE_UNDO_CONTEXT);
            return;
        }
        this.workspaceElements.set(element, {
            order: this.nextOrder++,
            participants: new Map(participants.map((participant) => [participant.context, participant])),
            removed: new Map(),
        });
        for (const participant of participants) this.pushElement(element, participant.context);
    }

    /**
     * The file was opened after a multi-document step that touched it: the step also enters
     * the new bucket, as in upstream, where history is bound to the resource rather than the tab.
     * Called on a fresh bucket, so the step order in it is the push order.
     */
    public adopt(context: string, resource: string, label: string): void {
        const adopted = new Map<IUndoRedoElement, WorkspaceElementState>();
        for (const stack of this.undoStacks.values()) {
            for (const element of stack) {
                const state = this.workspaceElements.get(element);
                if (state === undefined || state.removed.size > 0 || state.participants.has(context)) continue;
                if (element.resources.includes(resource)) adopted.set(element, state);
            }
        }
        // Buckets are iterated in creation order, not in step push order.
        const ordered = [...adopted].sort(([, a], [, b]) => a.order - b.order);
        for (const [element, state] of ordered) {
            state.participants.set(context, { context, label, owner: false });
            this.stack(this.undoStacks, context).push(element);
        }
    }

    public canUndo(context: string): boolean {
        return this.stack(this.undoStacks, context).length > 0;
    }

    public canRedo(context: string): boolean {
        return this.stack(this.redoStacks, context).length > 0;
    }

    public peekUndo(context: string): IUndoRedoElement | undefined {
        const stack = this.stack(this.undoStacks, context);
        return stack[stack.length - 1];
    }

    public peekRedo(context: string): IUndoRedoElement | undefined {
        const stack = this.stack(this.redoStacks, context);
        return stack[stack.length - 1];
    }

    /** `false`: nothing to undo or the step refused ({@link IUndoRedoElement.canUndo}); a refusing step stays on the stack. */
    public async undo(context: string): Promise<boolean> {
        const stack = this.stack(this.undoStacks, context);
        const element = stack.at(-1);
        if (!element) return false;
        if (!this.checkWorkspaceElement(element, this.undoStacks, "undo")) return false;
        const canUndo = element.canUndo?.();
        // A sync answer is not awaited, so the step moves to the redo stack before the first
        // await (see below). A promise means the step asks the disk; meanwhile the stack
        // may have shifted, and we must not pop someone else's top step.
        if (
            canUndo instanceof Promise
                ? !(await canUndo) || !this.isTopEverywhere(element, context, this.undoStacks)
                : canUndo === false
        ) {
            return false;
        }
        // Move between stacks synchronously (before await) so an immediate redo sees the
        // element; the sync part of element.undo() also runs before we return.
        this.move(element, context, this.undoStacks, this.redoStacks);
        await element.undo();
        return true;
    }

    public async redo(context: string): Promise<boolean> {
        const stack = this.stack(this.redoStacks, context);
        const element = stack.at(-1);
        if (!element) return false;
        if (!this.checkWorkspaceElement(element, this.redoStacks, "redo")) return false;
        const canRedo = element.canRedo?.();
        if (
            canRedo instanceof Promise
                ? !(await canRedo) || !this.isTopEverywhere(element, context, this.redoStacks)
                : canRedo === false
        ) {
            return false;
        }
        this.move(element, context, this.redoStacks, this.undoStacks);
        await element.redo();
        return true;
    }

    /** A multi-document step that edits this buffer breaks: the next undo drops it. */
    public clear(context: string, reason: UndoClearReason = "closed"): void {
        for (const element of this.stack(this.undoStacks, context))
            this.leave(element, context, reason, this.undoStacks);
        for (const element of this.stack(this.redoStacks, context))
            this.leave(element, context, reason, this.redoStacks);
        this.stack(this.undoStacks, context).length = 0;
        this.stack(this.redoStacks, context).length = 0;
    }

    /** Losing a bucket with its own edit breaks the step: in undo it is marked broken, in redo it is dropped everywhere. */
    private leave(
        element: IUndoRedoElement,
        context: string,
        reason: UndoClearReason,
        stacks: Map<string, IUndoRedoElement[]>,
    ): void {
        const state = this.workspaceElements.get(element);
        if (state === undefined) return;
        const participant = state.participants.get(context);
        // Stryker disable next-line ConditionalExpression: a step sits in a bucket only while the bucket is its participant (pushWorkspaceElement/adopt add both at once, leave removes both), so the participant always exists here
        if (participant === undefined) return;
        state.participants.delete(context);
        if (!participant.owner) return;
        if (stacks === this.undoStacks) {
            state.removed.set(participant.label, reason);
            return;
        }
        this.dropFromRedo(element, state);
    }

    /** A multi-document step dropped from one bucket's redo is dropped from all of them. */
    private truncateRedo(context: string): void {
        const redo = this.stack(this.redoStacks, context);
        // Copy: the step also leaves this bucket, which would mutate the array mid-iteration.
        for (const element of [...redo]) {
            const state = this.workspaceElements.get(element);
            if (state !== undefined) this.dropFromRedo(element, state);
        }
        redo.length = 0;
    }

    private dropFromRedo(element: IUndoRedoElement, state: WorkspaceElementState): void {
        for (const context of state.participants.keys()) {
            const redo = this.stack(this.redoStacks, context);
            const index = redo.indexOf(element);
            // Stryker disable next-line ConditionalExpression: a step leaves redo only here and from all participants at once, so it is always in a participant's redo; the guard protects against `splice(-1)`, which would remove another step
            if (index >= 0) redo.splice(index, 1);
        }
    }

    /**
     * Refusals use upstream's `cannotWorkspaceUndo*` strings. Upstream also drops a broken step
     * entirely; a step not on top in some bucket upstream would undo for "this file only", but here
     * the step is never split, so we refuse and keep the history intact.
     */
    private checkWorkspaceElement(
        element: IUndoRedoElement,
        stacks: Map<string, IUndoRedoElement[]>,
        kind: "undo" | "redo",
    ): boolean {
        const state = this.workspaceElements.get(element);
        if (state === undefined) return true;
        if (state.removed.size > 0) {
            for (const context of state.participants.keys()) {
                this.stack(this.undoStacks, context).length = 0;
                this.truncateRedo(context);
            }
            this.onDidRefuseEmitter.fire({
                element,
                message: `Could not ${kind} '${element.label}' across all files. ${removedMessage(state.removed)}`,
            });
            return false;
        }
        const changed = [...state.participants.values()]
            .filter((participant) => this.stack(stacks, participant.context).at(-1) !== element)
            .map((participant) => participant.label);
        if (changed.length > 0) {
            this.onDidRefuseEmitter.fire({
                element,
                message: `Could not ${kind} '${element.label}' across all files because changes were made to ${changed.join(", ")}`,
            });
            return false;
        }
        return true;
    }

    /** Whether the step is on top in all its buckets (for a plain step, in its own). */
    private isTopEverywhere(
        element: IUndoRedoElement,
        context: string,
        stacks: Map<string, IUndoRedoElement[]>,
    ): boolean {
        return this.contextsOf(element, context).every((each) => this.stack(stacks, each).at(-1) === element);
    }

    /** Pops the top step from all its buckets in `from` and pushes it to `to`. */
    private move(
        element: IUndoRedoElement,
        context: string,
        from: Map<string, IUndoRedoElement[]>,
        to: Map<string, IUndoRedoElement[]>,
    ): void {
        for (const each of this.contextsOf(element, context)) {
            this.stack(from, each).pop();
            this.stack(to, each).push(element);
        }
    }

    private contextsOf(element: IUndoRedoElement, context: string): string[] {
        const state = this.workspaceElements.get(element);
        return state === undefined ? [context] : [...state.participants.keys()];
    }
}

/** Explanation for a broken step: upstream's `RemovedResources.createMessage` strings. */
function removedMessage(removed: ReadonlyMap<string, UndoClearReason>): string {
    const closed = [...removed].filter(([, reason]) => reason === "closed").map(([label]) => label);
    const replaced = [...removed].filter(([, reason]) => reason === "replaced").map(([label]) => label);
    const messages: string[] = [];
    if (closed.length > 0) {
        messages.push(`The following files have been closed and modified on disk: ${closed.join(", ")}.`);
    }
    if (replaced.length > 0) {
        messages.push(`The following files have been modified in an incompatible way: ${replaced.join(", ")}.`);
    }
    return messages.join("\n");
}

export const UndoRedoServiceDIToken = token<UndoRedoService>("UndoRedoService");
