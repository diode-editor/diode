import * as path from "node:path";

/**
 * Columns of the Explorer header name a default 30-column sidebar shows: the header keeps the switcher chevron,
 * its New File / New Folder / Refresh buttons and "⋯", and a longer name is clipped before them.
 */
const VISIBLE_NAME_COLUMNS = 11;

/**
 * What the Explorer header reads for an opened path (#898): the folder name, or `<NAME> (WORKSPACE)` for a
 * `.code-workspace` file, upper-cased and clipped as the default sidebar clips it. The wait for "the workbench
 * shows Explorer" looks for it; the folder name differs between a worktree and a CI checkout, so it is computed,
 * not hard-coded.
 */
export function explorerTitle(openedPath: string): string {
    const label =
        path.extname(openedPath) === ".code-workspace"
            ? `${path.basename(openedPath, ".code-workspace")} (Workspace)`
            : path.basename(path.resolve(openedPath));
    return label.toUpperCase().slice(0, VISIBLE_NAME_COLUMNS);
}
