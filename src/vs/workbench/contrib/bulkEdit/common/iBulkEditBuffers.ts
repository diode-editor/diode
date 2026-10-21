import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IUndoRedoElement } from "../../../../platform/undoRedo/common/iUndoRedoElement.ts";
import type { IUndoParticipant } from "../../../../platform/undoRedo/common/undoRedoService.ts";

/**
 * An open resource is edited through the document and stays dirty instead of being rewritten on disk: otherwise
 * buffer and file would diverge and unsaved edits would be lost.
 */
export interface IBulkEditBuffer {
    /** Coordinates sent by the extension are clamped against it. */
    text(): string;
    /**
     * The step is handed to the caller: it joins the common step for the whole edit, not the document's bucket.
     * `null` — the edits changed nothing.
     */
    applyEdits(edits: readonly ITextEdit[], label: string): IUndoRedoElement | null;
    /** A save refusal is not an error: the buffer stays dirty, as upstream (which only logs it). */
    save(): Promise<void>;
}

/**
 * `"read-only"` — open, but the edit won't happen (`jdt:`, a diff side): the whole edit is rejected.
 * `null` — not open, edit on disk.
 */
export type BulkEditTarget = IBulkEditBuffer | "read-only" | null;

/** Resource is `uri.toString()`. */
export interface IBulkEditBuffers {
    get(resource: string): BulkEditTarget;
    /**
     * Buckets for ONE step for the whole edit. Every open touched resource is a participant: Ctrl+Z from any
     * of its tabs undoes the whole step. None touched — a single participant without an edit: the tab where
     * the action was invoked. Empty — the step goes to the workspace-operations bucket.
     */
    undoParticipants(touched: readonly string[]): IUndoParticipant[];
    /**
     * Deleted to the trash bypassing the file service — `FileOperation.Delete` won't arrive; tabs are handled
     * the same way: clean ones under the resource are closed.
     */
    didDelete(resource: string): void;
}

export const NULL_BULK_EDIT_BUFFERS: IBulkEditBuffers = {
    get: () => null,
    undoParticipants: () => [],
    didDelete: () => {
        /* no tabs — nothing to close */
    },
};

export const IBulkEditBuffersDIToken = token<IBulkEditBuffers>("IBulkEditBuffers");
