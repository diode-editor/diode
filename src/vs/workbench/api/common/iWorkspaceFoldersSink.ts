import type { IWireUpdateWorkspaceFolders } from "./wireTypes.ts";

/** Upstream checks already passed in the subprocess; the consumer explains an unsatisfiable set to the user. */
export interface IWorkspaceFoldersSink {
    update(request: IWireUpdateWorkspaceFolders): void;
}
