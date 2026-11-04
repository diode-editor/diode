import type { IRange } from "../core/iRange.ts";

/**
 * A text range an extension decoration type paints (`backgroundColor`/`color` of
 * `createTextEditorDecorationType`). Colors arrive resolved for the current theme, as packed RGBA: the
 * engine composites the alpha over what the cell already holds. The set is painted in order, a later
 * decoration over an earlier one.
 */
export interface IExtensionTextDecoration {
    readonly range: IRange;
    readonly bg?: number;
    readonly fg?: number;
    /** The background covers each line of the range across the whole text area; `fg` still paints only the glyphs. */
    readonly isWholeLine: boolean;
}
