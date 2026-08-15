import { TrashService, TrashServiceDIToken } from "../../platform/files/node/trashService.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { UndoRedoService, UndoRedoServiceDIToken } from "../../platform/undoRedo/common/undoRedoService.ts";
import {
    WorkspaceEditService,
    WorkspaceEditServiceDIToken,
} from "../../workbench/contrib/bulkEdit/node/workspaceEditService.ts";

/**
 * Сервисы единой системы отмены уровня workspace: история (`UndoRedoService`),
 * системная корзина (`TrashService`) и исполнитель файловых правок
 * (`WorkspaceEditService`). `WorkspaceEditService` зависит от `IConfigurationService`
 * (см. `configurationModule`).
 */
export const workspaceModule: ContainerModule = (container) => {
    container.bind(UndoRedoServiceDIToken, () => new UndoRedoService());
    container.bind(TrashServiceDIToken, () => new TrashService());
    container.bind(WorkspaceEditServiceDIToken, WorkspaceEditService);
};
