import type { ISemanticTokenColorRule, ITokenColorRule } from "./iThemeFile.ts";

/**
 * Parsed editor token theme for syntax highlighting.
 * This is a minimal structure that will be extended
 * when full TextMate grammar / syntax highlighting is implemented.
 */
export interface IEditorTokenTheme {
    /** Parsed token color rules from the VS Code theme file. */
    rules: ITokenColorRule[];

    /** `semanticHighlighting` темы: дефолт семантической подсветки при `configuredByTheme`. */
    semanticHighlighting?: boolean;

    /** Правила `semanticTokenColors` темы в порядке объявления. */
    semanticTokenRules?: readonly ISemanticTokenColorRule[];
}
