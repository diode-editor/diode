import { ITrashServiceDIToken } from "../../platform/files/common/iTrashService.ts";
import { TrashService } from "../../platform/files/node/trashService.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { UndoRedoService, UndoRedoServiceDIToken } from "../../platform/undoRedo/common/undoRedoService.ts";
import { IWorkspaceContextServiceDIToken } from "../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import {
    WorkspaceContextService,
    WorkspaceContextServiceDIToken,
} from "../../platform/workspace/common/workspaceContextService.ts";
import {
    WorkspaceEditService,
    WorkspaceEditServiceDIToken,
} from "../../workbench/contrib/bulkEdit/browser/workspaceEditService.ts";

/**
 * `WorkspaceEditService` биндится в `workbenchModule`: ему нужен `IBulkEditBuffers` полосы групп.
 * Два токена на один экземпляр: класс с писателем — только владельцу папки (`WorkbenchComponent`),
 * интерфейс без писателя — всем читателям.
 */
export const workspaceModule: ContainerModule = (container) => {
    container.bind(WorkspaceContextServiceDIToken, () => new WorkspaceContextService());
    container.bind(IWorkspaceContextServiceDIToken, () => container.get(WorkspaceContextServiceDIToken));
    container.bind(UndoRedoServiceDIToken, () => new UndoRedoService());
    container.bind(ITrashServiceDIToken, () => new TrashService());
    container.bind(WorkspaceEditServiceDIToken, WorkspaceEditService);
};
