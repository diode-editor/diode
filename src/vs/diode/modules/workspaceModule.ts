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
 * `WorkspaceEditService` is bound in `workbenchModule`: it needs the editor groups' `IBulkEditBuffers`.
 * Two tokens for one instance: the class with the writer goes only to the folder owner (`WorkbenchComponent`),
 * the writer-less interface to all readers.
 */
export const workspaceModule: ContainerModule = (container) => {
    container.bind(WorkspaceContextServiceDIToken, () => new WorkspaceContextService());
    container.bind(IWorkspaceContextServiceDIToken, () => container.get(WorkspaceContextServiceDIToken));
    container.bind(UndoRedoServiceDIToken, () => new UndoRedoService());
    container.bind(ITrashServiceDIToken, () => new TrashService());
    container.bind(WorkspaceEditServiceDIToken, WorkspaceEditService);
};
