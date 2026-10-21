import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { DetailedLineRangeMapping } from "../../../../editor/common/diff/rangeMapping.ts";
import type { IGutterChangeDecoration } from "../../../../editor/common/model/iGutterChangeDecoration.ts";

/**
 * The single coordinate seam (docs/arch/Editor.md): upstream `LineRange` is 1-based with
 * `endExclusive`, our gutter `IRange` is 0-based with inclusive `end.line`. An adapter rather than
 * a core migration: there is one call site (debt — docs/TODO/Diff.md).
 */

/** Already resolved by the theme to packed RGB. */
export interface IQuickDiffColors {
    readonly added: number;
    readonly modified: number;
    readonly deleted: number;
}

/**
 * Hunk kind is derived from empty ranges, as upstream. A deletion has no line of its own: it is
 * drawn on the boundary line ABOVE the deleted spot, or on the first line at the start of the file.
 */
export function toGutterDecorations(
    changes: readonly DetailedLineRangeMapping[],
    colors: IQuickDiffColors,
): IGutterChangeDecoration[] {
    const decorations: IGutterChangeDecoration[] = [];

    for (const change of changes) {
        if (change.modified.isEmpty) {
            const boundary = Math.max(0, change.modified.startLineNumber - 2);
            decorations.push({ range: createRange(boundary, 0, boundary, 0), color: colors.deleted });
            continue;
        }

        const firstLine = change.modified.startLineNumber - 1;
        const lastLine = change.modified.endLineNumberExclusive - 2;
        if (change.original.isEmpty) {
            decorations.push({ range: createRange(firstLine, 0, lastLine, 0), color: colors.added });
        } else {
            // VS Code draws a modification dashed and an insertion/deletion solid.
            decorations.push({ range: createRange(firstLine, 0, lastLine, 0), color: colors.modified, dashed: true });
        }
    }

    return decorations;
}
