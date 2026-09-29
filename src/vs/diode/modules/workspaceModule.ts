import { TrashService, TrashServiceDIToken } from "../../platform/files/node/trashService.ts";
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
} from "../../workbench/contrib/bulkEdit/node/workspaceEditService.ts";

/**
 * Сервисы уровня workspace: источник правды о папках воркспейса
 * (`WorkspaceContextService`) плюс единая система отмены — история
 * (`UndoRedoService`), системная корзина (`TrashService`) и исполнитель файловых
 * правок (`WorkspaceEditService`). `WorkspaceEditService` зависит от
 * `IConfigurationService` (см. `configurationModule`).
 *
 * У контекста воркспейса ДВА токена на один экземпляр, и это не церемония:
 * `WorkspaceContextServiceDIToken` отдаёт класс с писателем и берётся только
 * владельцем папки (`WorkbenchComponent`), `IWorkspaceContextServiceDIToken` —
 * интерфейс без писателя, и его берут все читатели.
 */
export const workspaceModule: ContainerModule = (container) => {
    container.bind(WorkspaceContextServiceDIToken, () => new WorkspaceContextService());
    container.bind(IWorkspaceContextServiceDIToken, () => container.get(WorkspaceContextServiceDIToken));
    container.bind(UndoRedoServiceDIToken, () => new UndoRedoService());
    container.bind(TrashServiceDIToken, () => new TrashService());
    container.bind(WorkspaceEditServiceDIToken, WorkspaceEditService);
};
