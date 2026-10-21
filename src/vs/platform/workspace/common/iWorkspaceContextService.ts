import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { Uri } from "../../../base/common/uri.ts";

/**
 * Addresses `workspaceStorage/<id>/`. For a `.code-workspace` workspace the id comes from the FILE
 * path, so two files over one folder are two projects. Callers pass the id, not a path: multi-root
 * will change one function, not the on-disk layout.
 */
export type WorkspaceId = string;

export interface IWorkspaceFolder {
    readonly uri: Uri;
    readonly name: string;
    /** Stable until the folder set changes. */
    readonly index: number;
}

export interface IWorkspace {
    /** `null` for an empty window. Upstream gives it an id too, we don't: no folder, no per-workspace store (`docs/TODO/MultiRoot.md`). */
    readonly id: WorkspaceId | null;
    /** 0 or 1 elements for now, there is no multi-root; readers take the "root" explicitly via `folders.at(0)`. */
    readonly folders: readonly IWorkspaceFolder[];
    /** Present only for a window opened via `*.code-workspace`; it also has exactly one folder. */
    readonly configuration?: Uri;
}

export type WorkbenchState =
    | "empty"
    | "folder"
    /** Workspace settings are the file's `settings` block, and the folder's `.diode/settings.json` is the folder layer. */
    | "workspace";

/** No writer here: the owner sets the folder set via `WorkspaceContextServiceDIToken`, everyone else only reads. */
export interface IWorkspaceContextService {
    getWorkspace(): IWorkspace;

    getWorkbenchState(): WorkbenchState;

    /** Matches by scheme and path prefix; the folder itself counts as "inside itself", as in upstream. */
    getWorkspaceFolder(resource: Uri): IWorkspaceFolder | null;

    /** The listener is NOT called immediately. */
    onDidChangeWorkspaceFolders(listener: () => void): IDisposable;
}
