import type { StyleFlags } from "@tuidom/core/common/styleFlags";

import type { IRange } from "../core/iRange.ts";

import type { TrackedRangeStickiness } from "./trackedDecorations.ts";

/**
 * Cells an extension decoration draws before or after its range (`before`/`after` of
 * `ThemableDecorationRenderOptions`), resolved for the current theme by the host; colors are packed RGBA.
 * `swatch`: `contentText` is empty and a color is given — upstream's colored box, drawn as `ColorDetector`'s
 * square. `text`: one line, already without control characters; no `fg` — the editor text color, no `bg` — the
 * line's own background.
 */
export type IExtensionDecorationAttachment =
    | { readonly kind: "swatch"; readonly color: number }
    | {
          readonly kind: "text";
          readonly text: string;
          readonly fg?: number;
          readonly bg?: number;
          readonly italic: boolean;
      };

/**
 * A text range an extension decoration type paints (`backgroundColor`/`color` of
 * `createTextEditorDecorationType`) and the cells it draws at its edges (`before`/`after`). Colors arrive
 * resolved for the current theme, as packed RGBA: the engine composites the alpha over what the cell already
 * holds. The editor tracks the range with `stickiness`, so until the next set the paint and the attachments
 * follow the text.
 */
export interface IExtensionTextDecoration {
    readonly range: IRange;
    readonly bg?: number;
    readonly fg?: number;
    /**
     * Cell attributes added to the glyphs of the range (`fontWeight`, `fontStyle`, `textDecoration` of the type),
     * on top of what the token set; absent — none.
     */
    readonly style?: StyleFlags;
    /**
     * The type's `opacity`, in (0, 1): the glyph color is blended toward the cell's final background, as the CSS
     * opacity of upstream's inline class shows the background through the text. Absent — opaque.
     */
    readonly opacity?: number;
    /** The background covers each line of the range across the whole text area; `fg` still paints only the glyphs. */
    readonly isWholeLine: boolean;
    /** The type's `rangeBehavior`; absent — `AlwaysGrowsWhenTypingAtEdges` (`OpenOpen`). */
    readonly stickiness?: TrackedRangeStickiness;
    /** At `range.start` (the line start with `isWholeLine`). */
    readonly before?: IExtensionDecorationAttachment;
    /** At `range.end` (the line end with `isWholeLine`). */
    readonly after?: IExtensionDecorationAttachment;
}

/**
 * The full set of one decoration type (`key`) for a resource; an empty set removes the type. Types are painted in
 * `key` (creation) order, a later one over an earlier one; within a type — in the given order.
 */
export interface IExtensionTextDecorationSet {
    readonly key: number;
    readonly decorations: readonly IExtensionTextDecoration[];
    /**
     * The same ranges as the type's previous set, with new colors (a theme change): the editor keeps the tracked
     * positions, as the host's coordinates are those of the last `setDecorations`, not of the current text.
     */
    readonly restyle?: boolean;
}
