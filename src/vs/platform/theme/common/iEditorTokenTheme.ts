import type { ISemanticTokenColorRule, ITokenColorRule } from "./iThemeFile.ts";

export interface IEditorTokenTheme {
    rules: ITokenColorRule[];

    /** Дефолт семантической подсветки при `configuredByTheme`. */
    semanticHighlighting?: boolean;

    /** В порядке объявления. */
    semanticTokenRules?: readonly ISemanticTokenColorRule[];
}
