import type { IThemeFile } from "./iThemeFile.ts";

/**
 * Повторяет `scripts/import-vscode-themes.mjs` (скрипт сборки импортировать её не может; тест
 * держит их в согласии). `colors` — merge, `tokenColors` и `semanticTokenRules` — конкатенация
 * base-first (поздний побеждает при равной специфичности), `semanticHighlighting` — OR.
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
