import type { IWorkspace } from "./iWorkspaceContextService.ts";
import { workspaceFileLabel } from "./workspaceFile.ts";

/**
 * Upstream `ILabelService.getWorkspaceLabel`: a `.code-workspace` window is `<file name> (Workspace)`,
 * a folder window is the folder name. An empty window has no label — `""`; each reader names it its own way.
 */
export function workspaceLabel(workspace: IWorkspace): string {
    if (workspace.configuration !== undefined) {
        return `${workspaceFileLabel(workspace.configuration.fsPath)} (Workspace)`;
    }
    return workspace.folders.at(0)?.name ?? "";
}
