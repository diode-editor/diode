import { describe, expect, it, vi } from "vitest";

import { parseThemeFile } from "./themeFileParser.ts";
import { WorkbenchTheme } from "./workbenchTheme.ts";

describe("parseThemeFile — JSONC", () => {
    it("читает комментарии и висячие запятые (так публикуют многие темы)", () => {
        const theme = parseThemeFile(`{
            // фон редактора
            "colors": {
                "editor.background": "#101010", /* блочный */
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

    it("сохраняет include для резолва вызывающим; не-строка — как отсутствие", () => {
        expect(parseThemeFile(`{ "include": "./base.json", "colors": {} }`).include).toBe("./base.json");
        expect(parseThemeFile(`{ "colors": {} }`)).toStrictEqual({ colors: {}, tokenColors: [] });
        expect(parseThemeFile(`{ "include": 5, "colors": {} }`)).toStrictEqual({ colors: {}, tokenColors: [] });
    });

    it("name из файла не читает — ключ темы задаёт манифест", () => {
        expect(parseThemeFile(`{ "name": "Inner Name", "colors": {} }`).name).toBeUndefined();
    });

    it("битый JSON — ошибка с позицией", () => {
        expect(() => parseThemeFile(`{ "colors": { "a": #fff } }`)).toThrow(/invalid JSON: .* at offset \d+/);
    });

    it("не-объект — ошибка", () => {
        expect(() => parseThemeFile(`[1, 2]`)).toThrow("not a JSON object");
        expect(() => parseThemeFile(`"str"`)).toThrow("not a JSON object");
        expect(() => parseThemeFile(`null`)).toThrow("not a JSON object");
    });

    it("файл без colors и tokenColors — пустая, но валидная тема", () => {
        expect(parseThemeFile(`{}`)).toStrictEqual({ colors: {}, tokenColors: [] });
    });
});

describe("parseThemeFile — спасаемое с warning", () => {
    it("невалидный цвет отбрасывается с warning, остальные остаются; результат резолвится без исключений", () => {
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

    it("без warn-колбэка предупреждения молча глотаются, результат тот же", () => {
        const theme = parseThemeFile(
            `{ "colors": { "editor.background": "#101010", "bad": "red" }, "tokenColors": "x.tmTheme" }`,
        );
        expect(theme).toStrictEqual({ colors: { "editor.background": "#101010" }, tokenColors: [] });
    });

    it("colors не объект (массив, null) — игнорируется с warning", () => {
        for (const colors of [`["#fff"]`, `null`, `"#fff"`]) {
            const warn = vi.fn();
            expect(parseThemeFile(`{ "colors": ${colors} }`, warn).colors).toEqual({});
            expect(warn).toHaveBeenCalledWith("colors is not an object — ignored");
        }
    });

    it("tokenColors строкой (.tmTheme) — не поддержано: пустые правила и warning", () => {
        const warn = vi.fn();
        const theme = parseThemeFile(`{ "colors": {}, "tokenColors": "./themes/Mono.tmTheme" }`, warn);
        expect(theme.tokenColors).toEqual([]);
        expect(warn).toHaveBeenCalledWith(
            'tokenColors "./themes/Mono.tmTheme": tmTheme tokenColors are not supported — syntax colors fall back to defaults',
        );
    });

    it("tokenColors не массив и не строка — игнорируется с warning", () => {
        const warn = vi.fn();
        expect(parseThemeFile(`{ "tokenColors": { "a": 1 } }`, warn).tokenColors).toEqual([]);
        expect(warn).toHaveBeenCalledWith("tokenColors is neither an array nor a path — ignored");
    });

    it("правило без settings и правило с кривым scope отбрасываются, валидные остаются", () => {
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

    it("невалидный foreground/background правила отбрасывается, само правило остаётся", () => {
        const warn = vi.fn();
        const theme = parseThemeFile(
            `{ "tokenColors": [{ "scope": "keyword", "settings": { "foreground": "red", "background": "#00FF00", "fontStyle": 1 } }] }`,
            warn,
        );
        expect(theme.tokenColors).toStrictEqual([{ scope: "keyword", settings: { background: "#00FF00" } }]);
        expect(warn).toHaveBeenCalledWith('tokenColors[0]: invalid foreground "red" — ignored');
    });

    it("неизвестные поля игнорируются молча", () => {
        const warn = vi.fn();
        const theme = parseThemeFile(`{ "author": "x", "colors": {} }`, warn);
        expect(theme).toEqual({ colors: {}, tokenColors: [] });
        expect(warn).not.toHaveBeenCalled();
    });
});

describe("parseThemeFile — семантическая подсветка", () => {
    it("semanticHighlighting берётся только булевым", () => {
        expect(parseThemeFile(`{ "semanticHighlighting": true }`).semanticHighlighting).toBe(true);
        expect(parseThemeFile(`{ "semanticHighlighting": false }`).semanticHighlighting).toBe(false);
        expect("semanticHighlighting" in parseThemeFile(`{ "semanticHighlighting": "yes" }`)).toBe(false);
    });

    it("semanticTokenColors: строка — foreground, объект — стиль; порядок объявления сохраняется", () => {
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

    it("невалидный цвет отбрасывается; правило без единого атрибута — пропуск с warning", () => {
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

    it("semanticTokenColors не объектом — warning, правил нет", () => {
        const warn = vi.fn();
        const theme = parseThemeFile(`{ "semanticTokenColors": ["#fff"] }`, warn);
        expect(theme.semanticTokenRules).toStrictEqual([]);
        expect(warn).toHaveBeenCalledWith("semanticTokenColors is not an object — ignored");
    });

    it("без полей семантики в файле их нет и в результате", () => {
        expect(Object.keys(parseThemeFile(`{ "colors": {} }`))).toEqual(["colors", "tokenColors"]);
    });
});
