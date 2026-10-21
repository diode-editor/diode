import * as path from "node:path";

import { passesThroughSymlink } from "../../../platform/files/node/passesThroughSymlink.ts";

export const WATCHER_INCLUDE_SETTING = "files.watcherInclude";

/**
 * Обход по симлинкам не ходит, поэтому каталог-ссылку надо следить явно. У эталона
 * события таких watch'ей идут в общий поток; у нас поток у каждого watcher'а свой —
 * путь подмешивается к тем, чья база его покрывает. Разрешение путей — как у
 * `workspaceWatcher.watchWorkspace`. Обычный каталог не берём: обход `base` дойдёт
 * до него сам, второй watch задвоил бы события (`removeDuplicateRequests` эталона).
 */
export function watcherIncludesUnder(base: string, setting: unknown, folders: readonly string[]): string[] {
    if (!Array.isArray(setting)) return [];
    const resolved = new Set<string>();
    // Пустая строка разрешается в саму папку и отсеивается ниже как база.
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

/** Каталог `..foo` — внутри, `..` — нет. */
function isEqualOrInside(parent: string, candidate: string): boolean {
    const relative = path.relative(parent, candidate);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
