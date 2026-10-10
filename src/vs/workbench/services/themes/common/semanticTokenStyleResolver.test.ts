import { describe, expect, it, vi } from "vitest";

import { parseHexColor } from "../../../../platform/theme/common/colorUtils.ts";
import type { IEditorTokenTheme } from "../../../../platform/theme/common/iEditorTokenTheme.ts";
import {
    createDefaultTokenClassificationRegistry,
    TokenClassificationRegistry,
} from "../../../../platform/theme/common/tokenClassificationRegistry.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";

import { SemanticTokenStyleResolver } from "./semanticTokenStyleResolver.ts";
import { darkModernTheme } from "./themes/darkModern.ts";

const RED = "#FF0000";
const GREEN = "#00FF00";
const BLUE = "#0000FF";

function resolver(theme: IEditorTokenTheme, registry = createDefaultTokenClassificationRegistry()) {
    return new SemanticTokenStyleResolver(registry, theme);
}

describe("SemanticTokenStyleResolver — фоллбэк на TextMate-скоупы темы", () => {
    it("тип красится цветом своей пробы из tokenColors", () => {
        const r = resolver({ rules: [{ scope: "variable", settings: { foreground: RED } }] });
        expect(r.resolve("variable", [], "ts")).toEqual({ fg: parseHexColor(RED) });
    });

    it("пробы по порядку: первая, давшая цвет, побеждает", () => {
        const r = resolver({
            rules: [
                { scope: "support.type", settings: { foreground: GREEN } },
                { scope: "entity.name.type", settings: { foreground: RED } },
            ],
        });
        expect(r.resolve("type", [], "ts")?.fg).toBe(parseHexColor(RED));
        const onlySecond = resolver({ rules: [{ scope: "support.type", settings: { foreground: GREEN } }] });
        expect(onlySecond.resolve("type", [], "ts")?.fg).toBe(parseHexColor(GREEN));
    });

    it("внутри пробы — более длинный совпавший скоуп правила; при равенстве — поздний", () => {
        const r = resolver({
            rules: [
                { scope: "entity.name.function", settings: { foreground: RED } },
                { scope: "entity.name", settings: { foreground: GREEN } },
                { scope: "entity.name.function", settings: { foreground: BLUE } },
            ],
        });
        expect(r.resolve("method", [], "ts")?.fg).toBe(parseHexColor(BLUE));
    });

    it("fontStyle правила задаёт все четыре флага; цвет и стиль берутся независимо", () => {
        const r = resolver({
            rules: [
                { scope: "comment", settings: { foreground: RED } },
                { scope: "comment.line", settings: { fontStyle: "italic underline" } },
                { scope: "comment", settings: { fontStyle: "bold strikethrough" } },
            ],
        });
        // Проба `comment`: `comment.line` под неё не подходит.
        expect(r.resolve("comment", [], "ts")).toEqual({
            fg: parseHexColor(RED),
            bold: true,
            italic: false,
            underline: false,
            strikethrough: true,
        });
    });

    it("правило без scope и пустой селектор не участвуют; массив scope — каждый элемент", () => {
        const r = resolver({
            rules: [
                { settings: { foreground: RED } },
                { scope: "", settings: { foreground: RED } },
                { scope: ["string.quoted", "string"], settings: { foreground: GREEN } },
            ],
        });
        expect(r.resolve("string", [], "ts")?.fg).toBe(parseHexColor(GREEN));
        expect(r.resolve("number", [], "ts")).toBeNull();
    });

    it("TM-селектор с исключением и родителем разбирается как в эталоне", () => {
        const r = resolver({
            rules: [
                { scope: "string -string.quoted", settings: { foreground: RED } },
                { scope: "source keyword.control", settings: { foreground: GREEN } },
            ],
        });
        expect(r.resolve("string", [], "ts")?.fg).toBe(parseHexColor(RED));
        // Путь из одного скоупа не содержит `source` — правило с родителем мимо.
        expect(r.resolve("keyword", [], "ts")).toBeNull();
    });

    it("проба-путь из semanticTokenScopes: все скоупы правила найдены в пути", () => {
        const registry = createDefaultTokenClassificationRegistry();
        registry.registerTokenStyleDefault(registry.parseTokenSelector("label"), {
            scopesToProbe: [["source", "entity.name.label"]],
        });
        const r = resolver({ rules: [{ scope: "source entity.name.label", settings: { foreground: RED } }] }, registry);
        expect(r.resolve("label", [], "ts")?.fg).toBe(parseHexColor(RED));
    });

    it("ничего не нашлось — null (токен не перекрывает TextMate)", () => {
        expect(resolver({ rules: [] }).resolve("variable", [], "ts")).toBeNull();
        expect(resolver({ rules: [] }).resolve("unknownType", ["x"], "ts")).toBeNull();
    });

    it("более специфичный дефолт побеждает: variable.readonly → variable.other.constant", () => {
        const r = resolver({
            rules: [
                { scope: "variable.other.constant", settings: { foreground: RED } },
                { scope: "variable", settings: { foreground: GREEN } },
            ],
        });
        expect(r.resolve("variable", ["readonly"], "ts")?.fg).toBe(parseHexColor(RED));
        expect(r.resolve("variable", [], "ts")?.fg).toBe(parseHexColor(GREEN));
    });
});

describe("SemanticTokenStyleResolver — semanticTokenColors темы", () => {
    it("правило темы перекрывает фоллбэк по заданным атрибутам и закрывает их", () => {
        const r = resolver({
            rules: [{ scope: "variable", settings: { foreground: RED, fontStyle: "italic" } }],
            semanticTokenRules: [{ selector: "variable", settings: { foreground: GREEN } }],
        });
        // Цвет — от semanticTokenColors, флаги — от фоллбэка (их правило темы не задало).
        expect(r.resolve("variable", [], "ts")).toEqual({
            fg: parseHexColor(GREEN),
            bold: false,
            italic: true,
            underline: false,
            strikethrough: false,
        });
    });

    it("правило темы с меньшим весом всё равно сильнее дефолта с большим", () => {
        const r = resolver({
            rules: [{ scope: "variable.other.constant", settings: { foreground: RED } }],
            semanticTokenRules: [{ selector: "*", settings: { foreground: GREEN } }],
        });
        expect(r.resolve("variable", ["readonly"], "ts")?.fg).toBe(parseHexColor(GREEN));
    });

    it("между правилами темы: больший вес побеждает, при равном — позднее", () => {
        const r = resolver({
            rules: [],
            semanticTokenRules: [
                { selector: "variable.readonly", settings: { foreground: RED } },
                { selector: "variable", settings: { foreground: GREEN } },
                { selector: "*.readonly", settings: { bold: true } },
                { selector: "*.readonly", settings: { bold: false } },
            ],
        });
        expect(r.resolve("variable", ["readonly"], "ts")).toEqual({ fg: parseHexColor(RED), bold: false });
    });

    it("поздний повтор селектора перекрывает только свои атрибуты (include-цепочка)", () => {
        const r = resolver({
            rules: [],
            semanticTokenRules: [
                { selector: "variable", settings: { foreground: RED, bold: true } },
                { selector: "variable", settings: { foreground: GREEN } },
            ],
        });
        expect(r.resolve("variable", [], "ts")).toEqual({ fg: parseHexColor(GREEN), bold: true });
    });

    it("fontStyle правила перекрывает отдельные булевы, пустой — сбрасывает всё", () => {
        const r = resolver({
            rules: [],
            semanticTokenRules: [
                { selector: "class", settings: { fontStyle: "underline", bold: true, italic: true } },
                { selector: "enum", settings: { fontStyle: "" } },
                { selector: "struct", settings: { italic: true, underline: false, strikethrough: true } },
            ],
        });
        expect(r.resolve("class", [], "ts")).toEqual({
            bold: false,
            italic: false,
            underline: true,
            strikethrough: false,
        });
        expect(r.resolve("enum", [], "ts")).toEqual({
            bold: false,
            italic: false,
            underline: false,
            strikethrough: false,
        });
        expect(r.resolve("struct", [], "ts")).toEqual({ italic: true, underline: false, strikethrough: true });
    });

    it("языковое правило применяется только к своему языку", () => {
        const r = resolver({
            rules: [],
            semanticTokenRules: [{ selector: "method:java", settings: { foreground: RED } }],
        });
        expect(r.resolve("method", [], "java")?.fg).toBe(parseHexColor(RED));
        expect(r.resolve("method", [], "ts")).toBeNull();
    });
});

describe("SemanticTokenStyleResolver — жизненный цикл", () => {
    it("semanticHighlighting — из активной темы", () => {
        const r = resolver({ rules: [], semanticHighlighting: true });
        expect(r.semanticHighlighting).toBe(true);
        r.setTheme({ rules: [] });
        expect(r.semanticHighlighting).toBe(false);
    });

    it("смена темы сбрасывает кэш и фаерит onDidChange", () => {
        const r = resolver({ rules: [{ scope: "variable", settings: { foreground: RED } }] });
        const listener = vi.fn();
        r.onDidChange(listener);
        expect(r.resolve("variable", [], "ts")?.fg).toBe(parseHexColor(RED));
        r.setTheme({ rules: [{ scope: "variable", settings: { foreground: GREEN } }] });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(r.resolve("variable", [], "ts")?.fg).toBe(parseHexColor(GREEN));
    });

    it("кэш по (тип, набор модификаторов, язык): порядок модификаторов не важен, язык — важен", () => {
        const r = resolver({
            rules: [],
            semanticTokenRules: [{ selector: "variable.readonly.static:java", settings: { foreground: RED } }],
        });
        const first = r.resolve("variable", ["readonly", "static"], "java");
        expect(r.resolve("variable", ["static", "readonly"], "java")).toBe(first);
        expect(r.resolve("variable", ["static", "readonly"], "ts")).toBeNull();
    });

    it("изменение классификации пересобирает правила темы и фаерит onDidChange; dispose отписывает", () => {
        const registry = new TokenClassificationRegistry();
        const r = resolver(
            { rules: [], semanticTokenRules: [{ selector: "type", settings: { foreground: RED } }] },
            registry,
        );
        const listener = vi.fn();
        r.onDidChange(listener);
        expect(r.resolve("annotation", [], "java")).toBeNull();
        registry.registerTokenType("annotation", "", "type");
        expect(listener).toHaveBeenCalledTimes(1);
        expect(r.resolve("annotation", [], "java")?.fg).toBe(parseHexColor(RED));
        r.dispose();
        registry.registerTokenType("other", "");
        expect(listener).toHaveBeenCalledTimes(1);
    });
});

describe("SemanticTokenStyleResolver — встроенная Dark Modern", () => {
    const theme = WorkbenchTheme.fromThemeFile(darkModernTheme).tokenTheme;
    const r = resolver(theme);

    it("тема включает семантическую подсветку", () => {
        expect(r.semanticHighlighting).toBe(true);
    });

    it("параметр, свойство, класс, функция — цвета Dark+ через фоллбэк", () => {
        expect(r.resolve("parameter", [], "java")?.fg).toBe(parseHexColor("#9CDCFE"));
        expect(r.resolve("property", [], "java")?.fg).toBe(parseHexColor("#9CDCFE"));
        expect(r.resolve("class", [], "java")?.fg).toBe(parseHexColor("#4EC9B0"));
        expect(r.resolve("method", [], "java")?.fg).toBe(parseHexColor("#DCDCAA"));
        expect(r.resolve("variable", ["readonly"], "java")?.fg).toBe(parseHexColor("#4FC1FF"));
    });

    it("semanticTokenColors темы: newOperator — из Dark+, перекрывший Dark VS", () => {
        expect(r.resolve("newOperator", [], "cpp")?.fg).toBe(parseHexColor("#C586C0"));
    });
});
