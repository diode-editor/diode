import type { IThemeFile } from "./iThemeFile.ts";

/**
 * Слияние темы с её базой по `include` — семантика VS Code, та же, что в
 * `scripts/import-vscode-themes.mjs` (скрипт — `.mjs` на этапе сборки и эту
 * функцию импортировать не может, поэтому повторяет её; тест держит их в
 * согласии): база ложится первой, поверх неё — включающая тема.
 *
 * - `colors` — object-merge, ключ `child` перекрывает ключ базы;
 * - `tokenColors` — конкатенация base-first: правило, объявленное позже,
 *   побеждает при равной специфичности (так устроен `TokenThemeResolver`);
 * - `semanticTokenRules` — тоже конкатенация base-first (поздний побеждает на
 *   равном весе селектора — `getTokenStyle` эталона);
 * - `semanticHighlighting` — OR по цепочке (`_loadColorTheme` эталона).
 *
 * `name` и `type` — от `child`; `include` в результате снят: зарегистрированная
 * тема всегда плоская.
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
