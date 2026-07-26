import { getCharDisplayWidth, getGraphemeDisplayWidth } from "./unicodeWidth.ts";

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

const DEFAULT_TAB_SIZE = 4;

/**
 * Display width of `raw` in terminal columns.
 *
 * Returns **exactly** the same number as
 * `new DisplayLine(raw, tabSize, stopAfter).displayWidth`, but without
 * allocating the per-grapheme slot array or the offset→column `Int32Array`.
 * Used by the horizontal-scrollbar width cache ({@link LineWidthCache}), where
 * only the width matters and building a full `DisplayLine` per document line is
 * what freezes the editor on long lines.
 *
 * `stopAfter` bounds the scan: any grapheme whose start offset is at or past it
 * is ignored (segmentation is lazy, so the tail is never touched). An extreme
 * line therefore costs O(stopAfter), not O(length) — mirroring VS Code's
 * `stopRenderingLineAfter`.
 *
 * The per-grapheme width rules are kept in lock-step with `DisplayLine`'s
 * constructor: tab expands to the next tab stop, `\r` is zero-width, single
 * code units go through {@link getCharDisplayWidth}, multi-code-unit clusters
 * through {@link getGraphemeDisplayWidth}.
 */
export function measureTextWidth(
    raw: string,
    tabSize: number = DEFAULT_TAB_SIZE,
    stopAfter: number = Infinity,
): number {
    let column = 0;

    for (const { segment, index } of segmenter.segment(raw)) {
        if (index >= stopAfter) break;

        if (segment === "\t") {
            column += tabSize - (column % tabSize);
        } else if (segment === "\r") {
            // zero width
        } else if (segment.length === 1) {
            column += getCharDisplayWidth(segment.charCodeAt(0));
        } else {
            column += getGraphemeDisplayWidth(segment);
        }
    }

    return column;
}
