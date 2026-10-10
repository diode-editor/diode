import { describe, expect, it } from "vitest";

import type { IThemeFile } from "./iThemeFile.ts";
import { mergeThemeFiles } from "./mergeThemeFiles.ts";

/**
 * Эталон семантики — `resolveTheme` в `scripts/import-vscode-themes.mjs`
 * (`.mjs` на этапе сборки, импортировать эту функцию не может и повторяет её):
 * `colors` — `Object.assign(base, child)`, `tokenColors` — `[...base, ...child]`.
 * Цепочка здесь — та же по форме, что Dark Modern → Dark+ → Dark VS.
 */
const DARK_VS: IThemeFile = {
    name: "Dark VS",
    type: "dark",
    colors: { "editor.background": "#1E1E1E", "editor.foreground": "#D4D4D4", foreground: "#CCCCCC" },
    tokenColors: [
        { scope: "comment", settings: { foreground: "#6A9955" } },
        { scope: "keyword", settings: { foreground: "#569CD6" } },
    ],
};

const DARK_PLUS: IThemeFile = {
    name: "Dark+",
    include: "./dark_vs.json",
    colors: { "editor.foreground": "#D4D4D5" },
    tokenColors: [{ scope: "keyword.control", settings: { foreground: "#C586C0" } }],
};

const DARK_MODERN: IThemeFile = {
    name: "Dark Modern",
    type: "dark",
    include: "./dark_plus.json",
    colors: { "editor.background": "#1F1F1F", "statusBar.background": "#181818" },
    tokenColors: [{ scope: "keyword", settings: { fontStyle: "bold" } }],
};

describe("mergeThemeFiles — семантика include как в scripts/import-vscode-themes.mjs", () => {
    it("colors: object-merge, ключ включающей темы перекрывает ключ базы", () => {
        const merged = mergeThemeFiles(DARK_VS, DARK_PLUS);
        expect(merged.colors).toEqual({
            "editor.background": "#1E1E1E",
            "editor.foreground": "#D4D4D5",
            foreground: "#CCCCCC",
        });
    });

    it("tokenColors: конкатенация base-first — правило включающей темы идёт последним и побеждает на равной специфичности", () => {
        const merged = mergeThemeFiles(DARK_VS, DARK_PLUS);
        expect(merged.tokenColors?.map((rule) => rule.scope)).toEqual(["comment", "keyword", "keyword.control"]);
    });

    it("цепочка из трёх файлов сворачивается в плоскую тему без include", () => {
        const flat = mergeThemeFiles(mergeThemeFiles(DARK_VS, DARK_PLUS), DARK_MODERN);
        expect(flat).toEqual({
            name: "Dark Modern",
            type: "dark",
            colors: {
                "editor.background": "#1F1F1F",
                "editor.foreground": "#D4D4D5",
                foreground: "#CCCCCC",
                "statusBar.background": "#181818",
            },
            tokenColors: [
                { scope: "comment", settings: { foreground: "#6A9955" } },
                { scope: "keyword", settings: { foreground: "#569CD6" } },
                { scope: "keyword.control", settings: { foreground: "#C586C0" } },
                { scope: "keyword", settings: { fontStyle: "bold" } },
            ],
        });
        expect("include" in flat).toBe(false);
    });

    it("name и type — от включающей темы; без своего type тема их не наследует у базы", () => {
        expect(mergeThemeFiles(DARK_VS, DARK_PLUS).name).toBe("Dark+");
        // Dark+ без `type`: реестр сам подставит dark, база тут ни при чём —
        // в VS Code тип определяет манифест (uiTheme), а не include. Ключа при
        // этом нет вовсе (не `type: undefined`).
        expect(Object.keys(mergeThemeFiles(DARK_VS, DARK_PLUS))).toEqual(["colors", "tokenColors", "name"]);
        expect(mergeThemeFiles(DARK_VS, DARK_MODERN).type).toBe("dark");
    });

    it("отсутствующие tokenColors с обеих сторон дают пустой массив", () => {
        const merged = mergeThemeFiles({ colors: { a: "#000" } }, { colors: { b: "#FFF" } });
        expect(merged).toStrictEqual({ colors: { a: "#000", b: "#FFF" }, tokenColors: [] });
    });

    it("не мутирует аргументы", () => {
        const base: IThemeFile = { colors: { a: "#000" }, tokenColors: [{ settings: {} }] };
        const child: IThemeFile = { colors: { a: "#111" }, tokenColors: [] };
        mergeThemeFiles(base, child);
        expect(base).toEqual({ colors: { a: "#000" }, tokenColors: [{ settings: {} }] });
        expect(child).toEqual({ colors: { a: "#111" }, tokenColors: [] });
    });

    it("semanticTokenRules: конкатенация base-first, повторный селектор остаётся двумя правилами", () => {
        const base: IThemeFile = {
            colors: {},
            semanticTokenRules: [{ selector: "variable", settings: { foreground: "#111111", bold: true } }],
        };
        const child: IThemeFile = {
            colors: {},
            semanticTokenRules: [{ selector: "variable", settings: { foreground: "#222222" } }],
        };
        expect(mergeThemeFiles(base, child).semanticTokenRules).toEqual([
            { selector: "variable", settings: { foreground: "#111111", bold: true } },
            { selector: "variable", settings: { foreground: "#222222" } },
        ]);
        expect(mergeThemeFiles({ colors: {} }, child).semanticTokenRules).toEqual(child.semanticTokenRules);
        expect(mergeThemeFiles(base, { colors: {} }).semanticTokenRules).toEqual(base.semanticTokenRules);
    });

    it("semanticHighlighting: OR по цепочке; ни у кого не задано — ключа нет", () => {
        const on: IThemeFile = { colors: {}, semanticHighlighting: true };
        const off: IThemeFile = { colors: {}, semanticHighlighting: false };
        expect(mergeThemeFiles(on, off).semanticHighlighting).toBe(true);
        expect(mergeThemeFiles(off, on).semanticHighlighting).toBe(true);
        expect(mergeThemeFiles(off, off).semanticHighlighting).toBeUndefined();
        expect(Object.keys(mergeThemeFiles({ colors: {} }, { colors: {} }))).toEqual(["colors", "tokenColors"]);
    });
});
