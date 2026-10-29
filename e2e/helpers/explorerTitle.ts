import * as path from "node:path";

/**
 * What the Explorer header reads for an opened path (#898): the folder name, or `<NAME> (WORKSPACE)` for a
 * `.code-workspace` file, upper-cased. The wait for "the workbench shows Explorer" looks for it; the window's
 * folder name differs between a worktree and a CI checkout, so it is computed, not hard-coded.
 */
export function explorerTitle(openedPath: string): string {
    const label =
        path.extname(openedPath) === ".code-workspace"
            ? `${path.basename(openedPath, ".code-workspace")} (Workspace)`
            : path.basename(path.resolve(openedPath));
    return label.toUpperCase();
}
