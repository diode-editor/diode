import * as path from "node:path";

import { passesThroughSymlink } from "../../../platform/files/node/sharedTreeWatcher.ts";

/** Ключ настройки «за этими каталогами-симлинками тоже следим». */
export const WATCHER_INCLUDE_SETTING = "files.watcherInclude";

/**
 * Дополнительные корни слежения для рекурсивного watcher'а расширения на
 * `base` — то, что эталон даёт настройкой `files.watcherInclude`.
 *
 * Обход по симлинкам не ходит (как parcel-watcher), поэтому каталог-ссылка
 * внутри воркспейса без явного запроса немой. В эталоне `workspaceWatcher`
 * заводит на каждый путь настройки отдельный рекурсивный watch, а его события
 * попадают в общий поток, который видят все watcher'ы расширений. У нас поток
 * у каждого watcher'а свой, поэтому путь подмешивается к тем watcher'ам, чья
 * база его покрывает.
 *
 * Разрешение — как у `workspaceWatcher.watchWorkspace`: абсолютный путь
 * принимается только внутри папки воркспейса, относительный приклеивается к
 * каждой папке. Остаются пути **строго внутри** `base` и только те, что лежат
 * за симлинком: до обычного каталога обход `base` дойдёт сам, и второй watch
 * дал бы расширению каждое событие дважды (эталон такой вложенный запрос тоже
 * выбрасывает — `removeDuplicateRequests`).
 */
export function watcherIncludesUnder(base: string, setting: unknown, folders: readonly string[]): string[] {
    if (!Array.isArray(setting)) return [];
    const resolved = new Set<string>();
    // Пустая строка отдельной проверки не требует: разрешается в саму папку, а
    // база (и всё, что её покрывает) отсеивается ниже.
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

/** `candidate` — сам `parent` или лежит внутри (каталог `..foo` — внутри, `..` — нет). */
function isEqualOrInside(parent: string, candidate: string): boolean {
    const relative = path.relative(parent, candidate);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
