export interface IThemeFile {
    name?: string;

    /** Base relative to this file; resolved on load ({@link mergeThemeFiles}), a registered theme is always flat. */
    include?: string;

    type?: "dark" | "light" | "hc" | "hcLight";

    /** Values are `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`. */
    colors: Record<string, string>;

    tokenColors?: ITokenColorRule[];

    /** Default for `editor.semanticHighlighting.enabled` = `configuredByTheme`; values are OR'ed along the `include` chain. */
    semanticHighlighting?: boolean;

    /**
     * An array, not the file's object: after merging with the base a selector may occur twice, and
     * the later one overrides the earlier only in its own attributes (upstream `semanticTokenRules`).
     */
    semanticTokenRules?: ISemanticTokenColorRule[];
}

/** Selector `(*|type)(.modifier)*(:language)?`. */
export interface ISemanticTokenColorRule {
    selector: string;
    settings: ISemanticTokenColorSettings;
}

/** A string in the file means `{ foreground }`. `fontStyle` (even empty) overrides all four flags at once. */
export interface ISemanticTokenColorSettings {
    foreground?: string;
    fontStyle?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
}

export interface ITokenColorRule {
    name?: string;

    scope?: string | string[];

    settings: ITokenColorSettings;
}

export interface ITokenColorSettings {
    foreground?: string;

    background?: string;

    /** Space-separated: `"bold"`, `"italic"`, `"underline"`, `"strikethrough"`. */
    fontStyle?: string;
}
