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
 * Как `DecorationsService.getDecoration(uri, includeChildren)` эталона: веса равные, поэтому цвет
 * папки — свой, а без него — первого всплывшего потомка в порядке обхода; свою букву папка с
 * всплывшими теряет ({@link BUBBLE_BADGE}). Сам корень строкой дерева не бывает.
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

/** Корень (`""`) и `".."` проходят, но всплывать им некуда. */
function isInside(relative: string): boolean {
    return !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Порядок обхода дерева: посегментно, префикс (родитель) раньше продолжений. */
function compareSegments(a: readonly string[], b: readonly string[]): number {
    // Stryker disable next-line MethodExpression,EqualityOperator: лишний шаг за концом короткого сравнивает с undefined — оба сравнения ложны, решает длина ниже
    const n = Math.min(a.length, b.length);
    // Stryker disable next-line EqualityOperator: см. выше — шаг за концом ничего не решает
    for (let i = 0; i < n; i++) {
        if (a[i] < b[i]) return -1;
        if (a[i] > b[i]) return 1;
    }
    return a.length - b.length;
}
