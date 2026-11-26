import type { BulkEdit } from "./workspaceEdit.ts";

/** Upstream `FileOperation` without `WRITE`. */
export type FileOperationKind = "create" | "copy" | "move" | "delete";

/** Upstream `SourceTargetPair`; both are `uri.toString()`. `source` is only there for a move or a copy. */
export interface IFileOperationPair {
    readonly source?: string;
    readonly target: string;
}

/** Upstream `IWorkingCopyFileOperationParticipant` plus `onDidRunWorkingCopyFileOperation`. */
export interface IFileOperationParticipant {
    /**
     * Before the operation, never on undo or redo. The edit joins the step of the operation. `null` — no edit;
     * a failure or a timeout must end here too: a participant doesn't stop the operation.
     */
    willRun(operation: FileOperationKind, files: readonly IFileOperationPair[]): Promise<BulkEdit | null>;
    /** After the operation, on undo and redo as well: there the operation is the reverse one. */
    didRun(operation: FileOperationKind, files: readonly IFileOperationPair[]): void;
}

export const NULL_FILE_OPERATION_PARTICIPANT: IFileOperationParticipant = {
    willRun: () => Promise.resolve(null),
    didRun: () => {
        /* nobody listens */
    },
};
