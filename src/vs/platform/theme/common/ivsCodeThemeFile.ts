export interface IThemeFile {
    name?: string;

    type?: "dark" | "light" | "hc" | "hcLight";

    /** Values are `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`. */
    colors: Record<string, string>;

    tokenColors?: ITokenColorRule[];
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
