export interface IThemeFile {
    name?: string;

    /** База относительно этого файла; разрешается при загрузке ({@link mergeThemeFiles}), зарегистрированная тема всегда плоская. */
    include?: string;

    type?: "dark" | "light" | "hc" | "hcLight";

    /** Значения — `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`. */
    colors: Record<string, string>;

    tokenColors?: ITokenColorRule[];

    /** Дефолт `editor.semanticHighlighting.enabled` = `configuredByTheme`; в цепочке `include` значения OR'ятся. */
    semanticHighlighting?: boolean;

    /**
     * Массив, а не объект файла: после слияния с базой селектор может встретиться дважды, и
     * поздний перекрывает ранний только в своих атрибутах (`semanticTokenRules` эталона).
     */
    semanticTokenRules?: ISemanticTokenColorRule[];
}

/** Селектор `(*|type)(.modifier)*(:language)?`. */
export interface ISemanticTokenColorRule {
    selector: string;
    settings: ISemanticTokenColorSettings;
}

/** Строка в файле — это `{ foreground }`. `fontStyle` (даже пустой) перекрывает все четыре флага разом. */
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

    /** Через пробел: `"bold"`, `"italic"`, `"underline"`, `"strikethrough"`. */
    fontStyle?: string;
}
