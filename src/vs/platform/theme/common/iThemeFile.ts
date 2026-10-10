/**
 * Color theme file definition.
 * Compatible with VS Code theme JSON format (1:1).
 *
 * @see https://code.visualstudio.com/api/references/theme-color
 */
export interface IThemeFile {
    /** Display name of the theme. */
    name?: string;

    /**
     * Path of a base theme to layer under this one, relative to this file
     * (VS Code's `"include": "./dark_plus.json"`). Resolved by whoever loads the
     * file (`scripts/import-vscode-themes.mjs` at build time for built-in
     * themes, `ExtensionThemeContributor` at startup for extension themes) via
     * {@link mergeThemeFiles}; a registered theme is always flat.
     */
    include?: string;

    /** Base theme type. */
    type?: "dark" | "light" | "hc" | "hcLight";

    /**
     * Workbench color customizations.
     * Keys use dot-notation (e.g. `"editor.background"`), values are hex color strings
     * in any of the formats: `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`.
     */
    colors: Record<string, string>;

    /** Syntax highlighting (TextMate) token color rules. */
    tokenColors?: ITokenColorRule[];

    /**
     * Семантическая подсветка по умолчанию для этой темы (`"semanticHighlighting"`
     * файла). Её читает настройка `editor.semanticHighlighting.enabled` в
     * значении `configuredByTheme`; в цепочке `include` значения OR'ятся.
     */
    semanticHighlighting?: boolean;

    /**
     * Правила `semanticTokenColors` в порядке объявления (база `include` —
     * первой). Объект файла `{ "<селектор>": "#hex" | { … } }` разобран в
     * массив: при слиянии с базой один селектор может встретиться дважды, и
     * поздний перекрывает ранний только в тех атрибутах, что задаёт сам — как
     * список `semanticTokenRules` эталона (`colorThemeData.ts`).
     */
    semanticTokenRules?: ISemanticTokenColorRule[];
}

/** Правило `semanticTokenColors`: селектор `(*|type)(.modifier)*(:language)?` и стиль. */
export interface ISemanticTokenColorRule {
    selector: string;
    settings: ISemanticTokenColorSettings;
}

/**
 * Стиль семантического токена. Строка в файле темы — это `{ foreground }`.
 * `fontStyle` (даже пустой) задаёт все четыре флага разом и перекрывает
 * отдельные `bold`/`italic`/`underline`/`strikethrough`.
 */
export interface ISemanticTokenColorSettings {
    foreground?: string;
    fontStyle?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
}

/**
 * A single TextMate token color rule, as found in VS Code theme files.
 */
export interface ITokenColorRule {
    /** Optional human-readable name for this rule. */
    name?: string;

    /** TextMate scope selector(s) this rule applies to. */
    scope?: string | string[];

    /** Colors and font style for matched tokens. */
    settings: ITokenColorSettings;
}

export interface ITokenColorSettings {
    /** Foreground color as hex string. */
    foreground?: string;

    /** Background color as hex string. */
    background?: string;

    /** Space-separated list of font styles: `"bold"`, `"italic"`, `"underline"`, `"strikethrough"`. */
    fontStyle?: string;
}
