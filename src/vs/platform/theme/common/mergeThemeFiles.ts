import type { IThemeFile } from "./iThemeFile.ts";

/**
 * Mirrors `scripts/import-vscode-themes.mjs` (the build script can't import this; a test keeps them
 * in sync). `colors` merge, `tokenColors` and `semanticTokenRules` concatenate base-first (the later
 * one wins at equal specificity), `semanticHighlighting` is OR'ed.
 */
export function mergeThemeFiles(base: IThemeFile, child: IThemeFile): IThemeFile {
    const merged: IThemeFile = {
        colors: { ...base.colors, ...child.colors },
        tokenColors: [...(base.tokenColors ?? []), ...(child.tokenColors ?? [])],
    };
    if (child.name !== undefined) merged.name = child.name;
    if (child.type !== undefined) merged.type = child.type;
    if (base.semanticHighlighting === true || child.semanticHighlighting === true) {
        merged.semanticHighlighting = true;
    }
    if (base.semanticTokenRules !== undefined || child.semanticTokenRules !== undefined) {
        merged.semanticTokenRules = [...(base.semanticTokenRules ?? []), ...(child.semanticTokenRules ?? [])];
    }
    return merged;
}
