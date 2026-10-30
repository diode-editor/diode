import * as path from "node:path";

import { Emitter } from "../../../base/common/event.ts";
import { Uri } from "../../../base/common/uri.ts";
import { token } from "../../instantiation/common/diContainer.ts";

import type {
    IWorkspace,
    IWorkspaceContextService,
    IWorkspaceFolder,
    WorkbenchState,
    WorkspaceId,
} from "./iWorkspaceContextService.ts";
import type { IWorkspaceFileContents } from "./workspaceFile.ts";
import { computeWorkspaceId } from "./workspaceId.ts";

/** Token for the owner of the folder set; readers use `IWorkspaceContextServiceDIToken`, an interface without a writer. */
export const WorkspaceContextServiceDIToken = token<WorkspaceContextService>("WorkspaceContextServiceOwner");

const EMPTY_WORKSPACE: IWorkspace = { id: null, folders: [] };

/** There is no "Close Folder", so no transition back to `empty` either. Multi-root will extend {@link setWorkspaceFolder}: readers already look at the array. */
export class WorkspaceContextService implements IWorkspaceContextService {
    private workspace: IWorkspace = EMPTY_WORKSPACE;
    private readonly onDidChangeWorkspaceFoldersEmitter = new Emitter<void>();
    public readonly onDidChangeWorkspaceFolders = this.onDidChangeWorkspaceFoldersEmitter.event;

    public getWorkspace(): IWorkspace {
        return this.workspace;
    }

    public getWorkbenchState(): WorkbenchState {
        if (this.workspace.configuration !== undefined) return "workspace";
        return this.workspace.folders.length === 0 ? "empty" : "folder";
    }

    public getWorkspaceFolder(resource: Uri): IWorkspaceFolder | null {
        for (const folder of this.workspace.folders) {
            if (resource.scheme !== folder.uri.scheme) continue;
            const base = withLowerCaseDrive(folder.uri.path);
            const prefix = base.endsWith("/") ? base : `${base}/`;
            const resourcePath = withLowerCaseDrive(resource.path);
            if (resourcePath === base || resourcePath.startsWith(prefix)) return folder;
        }
        return null;
    }

    /**
     * Opens a folder as the workspace and notifies subscribers. Called by the sole
     * owner, `WorkbenchComponent.setWorkspaceFolder`: from the `main.ts` bootstrap
     * and from the Open Folder command.
     *
     * Returns the {@link WorkspaceId} of the opened workspace, the same as
     * `getWorkspace().id` but without `null`: the owner needs it right away to
     * open per-workspace stores and has no reason to check for empty.
     *
     * The path is lifted into a `Uri` here: this is the "one point per layer" with
     * `path.resolve` right before `Uri.file` (docs/ARCHITECTURE.md);
     * the identity is computed from the same absolute path.
     */
    public setWorkspaceFolder(folderPath: string): WorkspaceId {
        const resolved = path.resolve(folderPath);
        const id = computeWorkspaceId(resolved);
        this.workspace = {
            id,
            folders: [{ uri: Uri.file(resolved), name: path.basename(resolved), index: 0 }],
        };
        this.onDidChangeWorkspaceFoldersEmitter.fire();
        return id;
    }

    /**
     * Opens a workspace from a `.code-workspace` file (already parsed by
     * `parseWorkspaceFile`) and notifies subscribers. The identity comes from the FILE
     * path, not the folder: two files over one directory are two projects with their own
     * stores, and both differ from the same folder opened directly.
     */
    public setWorkspaceFile(filePath: string, contents: IWorkspaceFileContents): WorkspaceId {
        const resolvedFile = path.resolve(filePath);
        const folder = path.resolve(contents.folder);
        const id = computeWorkspaceId(resolvedFile);
        this.workspace = {
            id,
            folders: [{ uri: Uri.file(folder), name: contents.folderName ?? path.basename(folder), index: 0 }],
            configuration: Uri.file(resolvedFile),
        };
        this.onDidChangeWorkspaceFoldersEmitter.fire();
        return id;
    }
}

/**
 * A Windows drive letter's case means nothing, and it differs in practice: `Uri.toString()` lowers it, so an
 * editor restored after a reload is `/d:/…` in a workspace opened as `/D:/…`.
 */
function withLowerCaseDrive(uriPath: string): string {
    return uriPath.replace(/^\/[A-Z]:/u, (drive) => drive.toLowerCase());
}
