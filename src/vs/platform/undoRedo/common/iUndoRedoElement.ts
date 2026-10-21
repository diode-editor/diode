export interface IUndoRedoElement {
    readonly label: string;
    /** Not the history key: the bucket is the `pushElement(element, context)` argument. Empty for an untitled buffer. */
    readonly resources: readonly string[];
    /** Set when undo is destructive (deletes files created by a paste): the confirmation text, gated by `explorer.confirmUndo`. */
    readonly confirmBeforeUndo?: string;
    /**
     * Absent means undo is always allowed. Needed by multi-document steps: text may have been
     * typed in one of the documents afterwards. `false` is a refusal, the step stays on the stack.
     * A promise is an answer from disk (the step edited a closed file: undo only if the disk
     * holds exactly what was written).
     */
    canUndo?(): boolean | Promise<boolean>;
    canRedo?(): boolean | Promise<boolean>;
    undo(): void | Promise<void>;
    redo(): void | Promise<void>;
}
