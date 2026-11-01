/**
 * Counterpart of upstream injected text (`IModelDecorationOptions.before/after`): cells absent
 * from the document, drawn BEFORE `offset` of `line`; the tail of the line moves right. The
 * caret never stands inside an insertion: at `offset` it is drawn on the side given by
 * {@link caretSide}, and a click on its cells maps to `offset`. Insertions at one offset are
 * drawn in the order given.
 */
export interface IInlineInsertion {
    readonly line: number;
    readonly offset: number;
    readonly text: string;
    /**
     * Packed RGB, already resolved (like `IGutterChangeDecoration`); wins over {@link colorToken}. A translucent
     * `packRgba` is blended by the frame over the cell's background.
     */
    readonly fg?: number;
    /** Theme token resolved at render time; neither this nor {@link fg} — the editor text color. */
    readonly colorToken?: string;
    /** Theme token of the cells' background, composited over the editor background; absent — the line's own. */
    readonly bgToken?: string;
    readonly italic?: boolean;
    readonly dim?: boolean;
    /** A selection, find match or occurrence spanning the insertion leaves its cells alone (inlay hints). */
    readonly outsideRangeBackgrounds?: boolean;
    /**
     * Where a caret at `offset` is drawn. `"left"` (the default, upstream injected-text affinity):
     * ghost text stays right of what was typed. `"right"`: the terminal caret is a block over the
     * cell right of the caret point, so an insertion that must never be covered by it (a color
     * swatch, a hint before an argument) puts the caret on the character after it. Deviation from upstream: there the caret is
     * a thin bar between cells and stays left of the swatch.
     */
    readonly caretSide?: "left" | "right";
}

export const NO_INLINE_INSERTIONS: readonly IInlineInsertion[] = [];
