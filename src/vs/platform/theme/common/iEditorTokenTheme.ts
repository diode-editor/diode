import type { ISemanticTokenColorRule, ITokenColorRule } from "./iThemeFile.ts";

export interface IEditorTokenTheme {
    rules: ITokenColorRule[];

    /** Semantic highlighting default under `configuredByTheme`. */
    semanticHighlighting?: boolean;

    /** In declaration order. */
    semanticTokenRules?: readonly ISemanticTokenColorRule[];
}
