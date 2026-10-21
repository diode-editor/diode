import { describe, expect, it, vi } from "vitest";

import { parseThemeFile } from "./themeFileParser.ts";
import { WorkbenchTheme } from "./workbenchTheme.ts";

describe("parseThemeFile — JSONC", () => {
    it("reads comments and trailing commas (many themes are published this way)", () => {
        const theme = parseThemeFile(`{
            // editor background
            "colors": {
                "editor.background": "#101010", /* block */
                "editor.foreground": "#F0F0F0",
            },
            "tokenColors": [
                { "scope": ["keyword", "storage"], "settings": { "foreground": "#FF0000", "fontStyle": "bold" }, },
            ],
        }`);
        expect(theme).toEqual({
            colors: { "editor.background": "#101010", "editor.foreground": "#F0F0F0" },
            tokenColors: [{ scope: ["keyword", "storage"], settings: { foreground: "#FF0000", fontStyle: "bold" } }],
        });
    });

    it("keeps include for the caller to resolve; a non-string counts as absent", () => {
        expect(parseThemeFile(`{ "include": "./base.json", "colors": {} }`).include).toBe("./base.json");
        expect(parseThemeFile(`{ "colors": {} }`)).toStrictEqual({ colors: {}, tokenColors: [] });
        expect(parseThemeFile(`{ "include": 5, "colors": {} }`)).toStrictEqual({ colors: {}, tokenColors: [] });
    });

    it("does not read name from the file; the manifest sets the theme key", () => {
        expect(parseThemeFile(`{ "name": "Inner Name", "colors": {} }`).name).toBeUndefined();
    });

    it("broken JSON is an error with a position", () => {
        expect(() => parseThemeFile(`{ "colors": { "a": #fff } }`)).toThrow(/invalid JSON: .* at offset \d+/);
    });

    it("a non-object is an error", () => {
        expect(() => parseThemeFile(`[1, 2]`)).toThrow("not a JSON object");
        expect(() => parseThemeFile(`"str"`)).toThrow("not a JSON object");
        expect(() => parseThemeFile(`null`)).toThrow("not a JSON object");
    });

    it("a file without colors and tokenColors is an empty but valid theme", () => {
        expect(parseThemeFile(`{}`)).toStrictEqual({ colors: {}, tokenColors: [] });
    });
});

describe("parseThemeFile: recoverable with a warning", () => {
    it("an invalid color is dropped with a warning, the rest stay; the result resolves without exceptions", () => {
        const warn = vi.fn();
        const theme = parseThemeFile(
            `{ "colors": { "editor.background": "#101010", "bad.one": "red", "bad.two": 12, "bad.three": "#12345" } }`,
            warn,
        );
        expect(theme.colors).toEqual({ "editor.background": "#101010" });
        expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
            'colors["bad.one"]: invalid color "red" — ignored',
            'colors["bad.two"]: invalid color 12 — ignored',
            'colors["bad.three"]: invalid color "#12345" — ignored',
        ]);
        expect(() => WorkbenchTheme.fromThemeFile({ ...theme, name: "x", type: "dark" })).not.toThrow();
    });

    it("without a warn callback warnings are silently swallowed; the result is the same", () => {
        const theme = parseThemeFile(
            `{ "colors": { "editor.background": "#101010", "bad": "red" }, "tokenColors": "x.tmTheme" }`,
        );
        expect(theme).toStrictEqual({ colors: { "editor.background": "#101010" }, tokenColors: [] });
    });

    it("colors that are not an object (array, null) are ignored with a warning", () => {
        for (const colors of [`["#fff"]`, `null`, `"#fff"`]) {
            const warn = vi.fn();
            expect(parseThemeFile(`{ "colors": ${colors} }`, warn).colors).toEqual({});
            expect(warn).toHaveBeenCalledWith("colors is not an object — ignored");
        }
    });

    it("tokenColors as a string (.tmTheme) is unsupported: empty rules and a warning", () => {
        const warn = vi.fn();
        const theme = parseThemeFile(`{ "colors": {}, "tokenColors": "./themes/Mono.tmTheme" }`, warn);
        expect(theme.tokenColors).toEqual([]);
        expect(warn).toHaveBeenCalledWith(
            'tokenColors "./themes/Mono.tmTheme": tmTheme tokenColors are not supported — syntax colors fall back to defaults',
        );
    });

    it("tokenColors that are neither an array nor a string are ignored with a warning", () => {
        const warn = vi.fn();
        expect(parseThemeFile(`{ "tokenColors": { "a": 1 } }`, warn).tokenColors).toEqual([]);
        expect(warn).toHaveBeenCalledWith("tokenColors is neither an array nor a path — ignored");
    });

    it("a rule without settings and a rule with a malformed scope are dropped, valid ones stay", () => {
        const warn = vi.fn();
        const theme = parseThemeFile(
            `{ "tokenColors": [
                { "scope": "comment" },
                { "scope": 42, "settings": { "foreground": "#000000" } },
                { "name": "Keyword", "scope": "keyword", "settings": { "foreground": "#FF0000" } },
                { "settings": { "foreground": "#AAAAAA", "background": "#00000080" } },
                { "scope": ["a", 1, "b"], "settings": { "fontStyle": "italic" } },
                null,
                { "scope": "x", "settings": null },
                { "name": 7, "scope": "y", "settings": {} }
            ] }`,
            warn,
        );
        expect(theme.tokenColors).toStrictEqual([
            { name: "Keyword", scope: "keyword", settings: { foreground: "#FF0000" } },
            { settings: { foreground: "#AAAAAA", background: "#00000080" } },
            { scope: ["a", "b"], settings: { fontStyle: "italic" } },
            { scope: "y", settings: {} },
        ]);
        expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
            "tokenColors[0]: rule without settings — ignored",
            "tokenColors[1]: scope is neither a string nor an array — ignored",
            "tokenColors[5]: rule without settings — ignored",
            "tokenColors[6]: rule without settings — ignored",
        ]);
    });

    it("an invalid rule foreground/background is dropped, the rule itself stays", () => {
        const warn = vi.fn();
        const theme = parseThemeFile(
            `{ "tokenColors": [{ "scope": "keyword", "settings": { "foreground": "red", "background": "#00FF00", "fontStyle": 1 } }] }`,
            warn,
        );
        expect(theme.tokenColors).toStrictEqual([{ scope: "keyword", settings: { background: "#00FF00" } }]);
        expect(warn).toHaveBeenCalledWith('tokenColors[0]: invalid foreground "red" — ignored');
    });

    it("unknown fields are silently ignored", () => {
        const warn = vi.fn();
        const theme = parseThemeFile(`{ "author": "x", "colors": {} }`, warn);
        expect(theme).toEqual({ colors: {}, tokenColors: [] });
        expect(warn).not.toHaveBeenCalled();
    });
});

describe("parseThemeFile: semantic highlighting", () => {
    it("semanticHighlighting is taken only as a boolean", () => {
        expect(parseThemeFile(`{ "semanticHighlighting": true }`).semanticHighlighting).toBe(true);
        expect(parseThemeFile(`{ "semanticHighlighting": false }`).semanticHighlighting).toBe(false);
        expect("semanticHighlighting" in parseThemeFile(`{ "semanticHighlighting": "yes" }`)).toBe(false);
    });

    it("semanticTokenColors: a string is a foreground, an object is a style; declaration order is kept", () => {
        const warn = vi.fn();
        const theme = parseThemeFile(
            `{ "semanticTokenColors": {
                "variable.readonly": "#FF0000",
                "*.declaration": { "fontStyle": "" },
                "method:java": { "foreground": "#00FF00", "bold": true, "italic": false, "underline": true, "strikethrough": false }
            } }`,
            warn,
        );
        expect(theme.semanticTokenRules).toStrictEqual([
            { selector: "variable.readonly", settings: { foreground: "#FF0000" } },
            { selector: "*.declaration", settings: { fontStyle: "" } },
            {
                selector: "method:java",
                settings: { foreground: "#00FF00", bold: true, italic: false, underline: true, strikethrough: false },
            },
        ]);
        expect(warn).not.toHaveBeenCalled();
    });

    it("an invalid color is dropped; a rule with no attributes is skipped with a warning", () => {
        const warn = vi.fn();
        const theme = parseThemeFile(
            `{ "semanticTokenColors": {
                "a": { "foreground": "red", "bold": true },
                "b": "red",
                "c": 42,
                "d": { "bold": "yes", "background": "#000000" }
            } }`,
            warn,
        );
        expect(theme.semanticTokenRules).toStrictEqual([{ selector: "a", settings: { bold: true } }]);
        expect(warn.mock.calls.map((c) => c[0] as string)).toEqual([
            'semanticTokenColors["a"]: invalid foreground "red" — ignored',
            'semanticTokenColors["b"]: invalid foreground "red" — ignored',
            'semanticTokenColors["b"]: no style — ignored',
            'semanticTokenColors["c"]: no style — ignored',
            'semanticTokenColors["d"]: no style — ignored',
        ]);
    });

    it("semanticTokenColors that is not an object: a warning, no rules", () => {
        const warn = vi.fn();
        const theme = parseThemeFile(`{ "semanticTokenColors": ["#fff"] }`, warn);
        expect(theme.semanticTokenRules).toStrictEqual([]);
        expect(warn).toHaveBeenCalledWith("semanticTokenColors is not an object — ignored");
    });

    it("without semantic fields in the file the result has none either", () => {
        expect(Object.keys(parseThemeFile(`{ "colors": {} }`))).toEqual(["colors", "tokenColors"]);
    });
});
