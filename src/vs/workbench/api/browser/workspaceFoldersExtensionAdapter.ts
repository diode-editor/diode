import type { NotificationService } from "../../services/notification/browser/notificationService.ts";
import type { IWorkspaceFoldersSink } from "../common/iWorkspaceFoldersSink.ts";
import type { IWireUpdateWorkspaceFolders } from "../common/wireTypes.ts";

/**
 * Мост `workspace.updateWorkspaceFolders` расширений к окну (реализация
 * {@link IWorkspaceFoldersSink}). Multi-root у нас нет (docs/TODO/MultiRoot.md),
 * поэтому выполним только итог ровно в одну папку — она открывается, как
 * `File: Open Folder` (субпроцесс расширений перезапускается — как reload окна у
 * эталона, который в таком случае входит в новый воркспейс). Любой другой итог
 * (вторая папка, пустое окно) — тост ошибки с формулировкой эталона
 * (`Extension '{0}' failed to update workspace folders: {1}`); расширению при
 * этом уже вернулся `false` (решение человека: «false + тост»).
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
