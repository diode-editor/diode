import * as path from "node:path";

/** Файловая декорация от расширения: цвет уже резолвнут, `propagate` — всплывать ли к папкам. */
export interface IFileDecorationEntry {
    readonly path: string;
    readonly color?: number;
    readonly badge?: string;
    readonly propagate?: boolean;
}

/** Бейдж папки, внутри которой есть всплывшие декорации (codicon `circle-filled` эталона). */
export const BUBBLE_BADGE = "●";

/**
 * Собирает декорации строк дерева: свои у каждого пути плюс всплывшие к папкам
 * от потомков с `propagate` (VS Code `DecorationsService.getDecoration(uri,
 * includeChildren)`). Как в эталоне, веса у декораций расширений равные, поэтому
 * цвет папки — её собственный, а без него — первого всплывшего потомка в порядке
 * обхода дерева (сегменты по алфавиту, родитель раньше детей). Бейдж папки с
 * всплывшими потомками — {@link BUBBLE_BADGE} вместо буквы: свою букву папка при
 * этом теряет, как и в эталоне (`bubbleBadgeClassName`). Всплывают только пути
 * под `rootPath` и только до него: сам корень строкой дерева не бывает.
 */
export function bubbleFileDecorations(
    entries: readonly IFileDecorationEntry[],
    rootPath: string,
): Map<string, { color?: number; badge?: string }> {
    const result = new Map<string, { color?: number; badge?: string }>();
    for (const entry of entries) result.set(entry.path, { color: entry.color, badge: entry.badge });
    const bubbling = entries
        .filter((entry) => entry.propagate === true)
        .map((entry) => ({ entry, relative: path.relative(rootPath, entry.path) }))
        .filter(({ relative }) => isInside(relative))
        .map(({ entry, relative }) => ({ entry, segments: relative.split(path.sep) }))
        .sort((a, b) => compareSegments(a.segments, b.segments));
    for (const { entry, segments } of bubbling) {
        let dir = rootPath;
        for (const segment of segments.slice(0, -1)) {
            dir = path.join(dir, segment);
            const own = result.get(dir);
            result.set(dir, { color: own?.color ?? entry.color, badge: BUBBLE_BADGE });
        }
    }
    return result;
}

/** Путь (относительно корня) лежит строго под корнем. */
function isInside(relative: string): boolean {
    return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Порядок обхода дерева: посегментно, префикс (родитель) раньше продолжений. */
function compareSegments(a: readonly string[], b: readonly string[]): number {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return a.length - b.length;
}
