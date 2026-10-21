import type { NotificationService } from "../../services/notification/browser/notificationService.ts";
import type { IWorkspaceFoldersSink } from "../common/iWorkspaceFoldersSink.ts";
import type { IWireUpdateWorkspaceFolders } from "../common/wireTypes.ts";

/**
 * Multi-root нет: выполним только итог ровно в одну папку (как `File: Open Folder`). Иначе —
 * тост с формулировкой эталона, расширению уже вернулся `false` (решение человека).
 */
export class WorkspaceFoldersExtensionAdapter implements IWorkspaceFoldersSink {
    public constructor(
        private readonly openFolder: (path: string) => void,
        private readonly notifications: Pick<NotificationService, "show">,
        private readonly extensionName: (extensionId: string) => string | undefined,
    ) {}

    public update(request: IWireUpdateWorkspaceFolders): void {
        if (request.folders.length === 1) {
            this.openFolder(request.folders[0]);
            return;
        }
        const id = request.extensionId;
        const name = id === null ? "unknown" : (this.extensionName(id) ?? id);
        this.notifications.show({
            severity: "error",
            message: `Extension '${name}' failed to update workspace folders: multi-root workspaces are not supported`,
            modal: false,
            items: [],
        });
    }
}
