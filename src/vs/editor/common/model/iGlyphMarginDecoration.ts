/**
 * A glyph in the gutter's glyph lane (upstream `glyphMarginClassName`), left of the line numbers. Clicking it fires
 * `EditorElement.onDidClickGlyphMargin` with its `key`; the cursor stays.
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
    /** A theme token: a mark in the scrollbar at the line (upstream `overviewRuler`). */
    readonly overviewRulerColorToken?: string;
}

/** A click on a glyph: its key, the button and where the pointer was. */
export interface IGlyphMarginClick {
    readonly key: string;
    readonly button: "left" | "right";
    readonly screenX: number;
    readonly screenY: number;
}
