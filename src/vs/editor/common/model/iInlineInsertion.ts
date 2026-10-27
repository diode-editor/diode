/**
 * Counterpart of upstream injected text (`IModelDecorationOptions.before/after`): cells absent
 * from the document, drawn BEFORE `offset` of `line`; the tail of the line moves right. The
 * caret never stands inside an insertion: at `offset` it is drawn left of it, and a click on
 * its cells maps to `offset`. Insertions at one offset are drawn in the order given.
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
    readonly italic?: boolean;
}

export const NO_INLINE_INSERTIONS: readonly IInlineInsertion[] = [];
