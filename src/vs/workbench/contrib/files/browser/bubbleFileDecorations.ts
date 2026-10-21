import * as path from "node:path";

/** A file decoration from an extension: the color is already resolved; `propagate` bubbles it up to folders. */
export interface IFileDecorationEntry {
    readonly path: string;
    readonly color?: number;
    readonly badge?: string;
    readonly propagate?: boolean;
}

/** Badge of a folder that contains bubbled decorations (upstream's `circle-filled` codicon). */
export const BUBBLE_BADGE = "●";

/**
 * Like upstream's `DecorationsService.getDecoration(uri, includeChildren)`: weights are equal, so a
 * folder keeps its own color, or else takes the first bubbled descendant's in traversal order; a
 * folder with bubbled children loses its own letter ({@link BUBBLE_BADGE}). The root itself is never
 * a tree row.
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

/** The root (`""`) and `".."` pass, but have nowhere to bubble to. */
function isInside(relative: string): boolean {
    return !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Tree traversal order: segment by segment, a prefix (parent) before its continuations. */
function compareSegments(a: readonly string[], b: readonly string[]): number {
    // Stryker disable next-line MethodExpression,EqualityOperator: an extra step past the shorter one compares with undefined — both comparisons are false, the length below decides
    const n = Math.min(a.length, b.length);
    // Stryker disable next-line EqualityOperator: see above — a step past the end decides nothing
    for (let i = 0; i < n; i++) {
        if (a[i] < b[i]) return -1;
        if (a[i] > b[i]) return 1;
    }
    return a.length - b.length;
}
