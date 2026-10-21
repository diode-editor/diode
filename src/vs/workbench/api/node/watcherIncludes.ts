import * as path from "node:path";

import { passesThroughSymlink } from "../../../platform/files/node/passesThroughSymlink.ts";

export const WATCHER_INCLUDE_SETTING = "files.watcherInclude";

/**
 * The walk does not follow symlinks, so a linked directory must be watched explicitly. Upstream,
 * events of such watches go into a shared stream; here every watcher has its own stream, so
 * the path is mixed into those whose base covers it. Paths are resolved as in
 * `workspaceWatcher.watchWorkspace`. A plain directory is skipped: the `base` walk reaches
 * it on its own, and a second watch would duplicate events (upstream's `removeDuplicateRequests`).
 */
export function watcherIncludesUnder(base: string, setting: unknown, folders: readonly string[]): string[] {
    if (!Array.isArray(setting)) return [];
    const resolved = new Set<string>();
    // An empty string resolves to the folder itself and is filtered out below as the base.
    for (const entry of setting) {
        if (typeof entry !== "string") continue;
        if (path.isAbsolute(entry)) {
            const candidate = path.resolve(entry);
            if (folders.some((folder) => isEqualOrInside(folder, candidate))) resolved.add(candidate);
        } else {
            for (const folder of folders) resolved.add(path.resolve(folder, entry));
        }
    }
    const result: string[] = [];
    for (const candidate of resolved) {
        const relative = path.relative(base, candidate);
        if (relative === "" || !isEqualOrInside(base, candidate)) continue;
        if (passesThroughSymlink(base, relative)) result.push(candidate);
    }
    return result;
}

/** The `..foo` directory is inside, `..` is not. */
function isEqualOrInside(parent: string, candidate: string): boolean {
    const relative = path.relative(parent, candidate);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
