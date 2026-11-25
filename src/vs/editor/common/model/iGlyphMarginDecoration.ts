/**
 * A glyph in the gutter's glyph lane (upstream `glyphMarginClassName`), left of the line numbers. Clicking it fires
 * `EditorElement.onDidClickGlyphMargin` with its owner and `key`; the cursor stays.
 */
export interface IGlyphMarginDecoration {
    /** The owner's identity of the glyph: one set again with the same `key` and `line` keeps the line it moved to. */
    readonly key: string;
    /** 0-based. */
    readonly line: number;
    /** One cell. */
    readonly glyph: string;
    /** A theme token. */
    readonly colorToken: string;
    /** A color its owner resolved itself, packed RGBA (an extension's icon color): drawn instead of `colorToken`. */
    readonly color?: number;
    /** A theme token: a mark in the scrollbar at the line (upstream `overviewRuler`). */
    readonly overviewRulerColorToken?: string;
    /**
     * Upstream `zIndex`: the lane has one cell, so of the glyphs of several owners on a line the highest is drawn and
     * clicked; a tie goes to the owner that set its glyphs first. Absent is 0.
     */
    readonly zIndex?: number;
}

/**
 * A press on the glyph lane of a line (upstream `MouseTargetType.GUTTER_GLYPH_MARGIN`): with the glyph drawn there,
 * its owner and key, or neither on a line without one. The cursor stays.
 */
export interface IGlyphMarginClick {
    /** 0-based. */
    readonly line: number;
    readonly owner?: string;
    readonly key?: string;
    readonly button: "left" | "middle" | "right";
    readonly shiftKey: boolean;
    readonly altKey: boolean;
    readonly screenX: number;
    readonly screenY: number;
}

/** A whole line's background by a theme token (upstream `isWholeLine` with a `className`), riding its line through edits. */
export interface ILineHighlightDecoration {
    readonly key: string;
    /** 0-based. */
    readonly line: number;
    /** A theme token, painted over the editor background of the text area, not the gutter. */
    readonly colorToken: string;
}
