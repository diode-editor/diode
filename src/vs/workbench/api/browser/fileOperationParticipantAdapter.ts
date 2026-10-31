import type { IConfigurationService } from "../../../platform/configuration/common/iConfigurationService.ts";
import type { ProgressService } from "../../../platform/progress/common/progressService.ts";
import type {
    FileOperationKind,
    IFileOperationPair,
    IFileOperationParticipant,
} from "../../contrib/bulkEdit/common/iFileOperationParticipant.ts";
import type { BulkEdit } from "../../contrib/bulkEdit/common/workspaceEdit.ts";
import type { FileOperationsCustomer } from "../../services/extensions/node/customers/fileOperationsCustomer.ts";

import { toWorkspaceEdit } from "./editorOptionsServiceAdapter.ts";

const PROGRESS_TITLES: Readonly<Record<FileOperationKind, string>> = {
    create: "Running 'File Create' participants...",
    move: "Running 'File Rename' participants...",
    copy: "Running 'File Copy' participants...",
    delete: "Running 'File Delete' participants...",
};

/**
 * Upstream `mainThreadFileSystemEventService`. Deviations: the progress goes to the status bar, not to a cancellable
 * notification; there is no "wants to make refactoring changes" prompt: no preview to offer, and the edit is one
 * undo step with the operation.
 */
export class FileOperationParticipantAdapter implements IFileOperationParticipant {
    public constructor(
        private readonly host: Pick<FileOperationsCustomer, "willRunFileOperation" | "didRunFileOperation">,
        private readonly config: IConfigurationService,
        private readonly progress: Pick<ProgressService, "withProgress">,
    ) {}

    public async willRun(operation: FileOperationKind, files: readonly IFileOperationPair[]): Promise<BulkEdit | null> {
        const timeoutMs = this.config.get("files.participants.timeout");
        // Upstream `WorkingCopyFileOperationParticipant`: anything but a positive number disables.
        if (!(timeoutMs > 0)) return null;
        const ops = await this.progress.withProgress({ location: "window", title: PROGRESS_TITLES[operation] }, () =>
            this.host.willRunFileOperation({ operation, files, timeoutMs }),
        );
        return toWorkspaceEdit(ops);
    }

    public didRun(operation: FileOperationKind, files: readonly IFileOperationPair[]): void {
        this.host.didRunFileOperation({ operation, files });
    }
}
