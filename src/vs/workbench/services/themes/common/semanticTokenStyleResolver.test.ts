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
        expect(r.resolve("variable", [], "ts")).toStrictEqual({ fg: parseHexColor(RED) });
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
        expect(r.resolve("comment", [], "ts")).toStrictEqual({
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
        expect(r.resolve("variable", [], "ts")).toStrictEqual({
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
        expect(r.resolve("variable", ["readonly"], "ts")).toStrictEqual({ fg: parseHexColor(RED), bold: false });
    });

    it("поздний повтор селектора перекрывает только свои атрибуты (include-цепочка)", () => {
        const r = resolver({
            rules: [],
            semanticTokenRules: [
                { selector: "variable", settings: { foreground: RED, bold: true } },
                { selector: "variable", settings: { foreground: GREEN } },
            ],
        });
        expect(r.resolve("variable", [], "ts")).toStrictEqual({ fg: parseHexColor(GREEN), bold: true });
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
        expect(r.resolve("class", [], "ts")).toStrictEqual({
            bold: false,
            italic: false,
            underline: true,
            strikethrough: false,
        });
        expect(r.resolve("enum", [], "ts")).toStrictEqual({
            bold: false,
            italic: false,
            underline: false,
            strikethrough: false,
        });
        expect(r.resolve("struct", [], "ts")).toStrictEqual({ italic: true, underline: false, strikethrough: true });
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

describe("SemanticTokenStyleResolver — матч TM-правил по пробе (resolveScopes эталона)", () => {
    /** Реестр с единственным дефолтом: тип `t` → заданные пробы. */
    function probing(probes: string[][], selector = "t") {
        const registry = new TokenClassificationRegistry();
        registry.registerTokenStyleDefault(registry.parseTokenSelector(selector), { scopesToProbe: probes });
        return registry;
    }

    it("правило из нескольких идентификаторов требует найти каждый, даже при длинной пробе", () => {
        const r = resolver(
            { rules: [{ scope: "meta.x entity.name", settings: { foreground: RED } }] },
            probing([["source", "entity.name.label"]]),
        );
        expect(r.resolve("t", [], "x")).toBeNull();
    });

    it("один скоуп пробы не засчитывается за два идентификатора правила", () => {
        const r = resolver(
            { rules: [{ scope: "string string", settings: { foreground: RED } }] },
            probing([["string"]]),
        );
        expect(r.resolve("t", [], "x")).toBeNull();
    });

    it("вес по позиции в пробе старше длины идентификатора", () => {
        const r = resolver(
            {
                rules: [
                    { scope: "x", settings: { foreground: GREEN } },
                    { scope: "source.abc.def.ghi", settings: { foreground: RED } },
                ],
            },
            probing([["source.abc.def.ghi", "x"]]),
        );
        expect(r.resolve("t", [], "x")?.fg).toBe(parseHexColor(GREEN));
    });

    it("префикс совпадает только по границе точки", () => {
        const r = resolver(
            { rules: [{ scope: "variable.other.read", settings: { foreground: RED } }] },
            probing([["variable.other.readwrite"]]),
        );
        expect(r.resolve("t", [], "x")).toBeNull();
    });

    it("правило без scope (глобальные настройки темы) не совпадает ни с чем", () => {
        const r = resolver({ rules: [{ settings: { foreground: RED } }] }, probing([["undefined"]]));
        expect(r.resolve("t", [], "x")).toBeNull();
    });

    it("отрицание даёт вес 0, и такое правило всё равно применяется", () => {
        const r = resolver(
            { rules: [{ scope: "-comment", settings: { foreground: RED, fontStyle: "italic" } }] },
            probing([["string"]]),
        );
        expect(r.resolve("t", [], "x")).toStrictEqual({
            fg: parseHexColor(RED),
            bold: false,
            italic: true,
            underline: false,
            strikethrough: false,
        });
    });

    it("fontStyle: старший по весу побеждает, при равенстве — поздний; правило без fontStyle его не стирает", () => {
        const r = resolver(
            {
                rules: [
                    { scope: "comment.line", settings: { fontStyle: "italic" } },
                    { scope: "comment", settings: { fontStyle: "bold" } },
                    { scope: "comment", settings: { foreground: RED } },
                ],
            },
            probing([["comment.line.double"]]),
        );
        expect(r.resolve("t", [], "x")).toStrictEqual({
            fg: parseHexColor(RED),
            bold: false,
            italic: true,
            underline: false,
            strikethrough: false,
        });
        const tie = resolver(
            {
                rules: [
                    { scope: "comment", settings: { fontStyle: "italic" } },
                    { scope: "comment", settings: { fontStyle: "underline" } },
                ],
            },
            probing([["comment"]]),
        );
        expect(tie.resolve("t", [], "x")?.underline).toBe(true);
    });

    it("проба, давшая только fontStyle, — уже ответ: следующая проба не смотрится", () => {
        const r = resolver(
            {
                rules: [
                    { scope: "entity.name.type", settings: { fontStyle: "bold" } },
                    { scope: "support.type", settings: { foreground: GREEN } },
                ],
            },
            probing([["entity.name.type"], ["support.type"]]),
        );
        expect(r.resolve("t", [], "x")).toStrictEqual({
            bold: true,
            italic: false,
            underline: false,
            strikethrough: false,
        });
    });

    it("дефолт с селектором `*` (вес 0) применяется", () => {
        const r = resolver({ rules: [{ scope: "string", settings: { foreground: RED } }] }, probing([["string"]], "*"));
        expect(r.resolve("anything", [], "x")?.fg).toBe(parseHexColor(RED));
    });
});

describe("SemanticTokenStyleResolver — веса атрибутов", () => {
    it("правило темы задало только флаг — цвет добирается из фоллбэка", () => {
        const r = resolver({
            rules: [{ scope: "variable", settings: { foreground: GREEN } }],
            semanticTokenRules: [{ selector: "variable", settings: { bold: true } }],
        });
        expect(r.resolve("variable", [], "ts")).toStrictEqual({ fg: parseHexColor(GREEN), bold: true });
    });

    it("флаг от правила с большим весом не перебивается поздним правилом с меньшим", () => {
        const r = resolver({
            rules: [],
            semanticTokenRules: [
                { selector: "variable.readonly", settings: { bold: true } },
                { selector: "variable", settings: { bold: false } },
            ],
        });
        expect(r.resolve("variable", ["readonly"], "ts")).toStrictEqual({ bold: true });
    });
});

describe("SemanticTokenStyleResolver — жизненный цикл", () => {
    it("ключ кэша различает наборы модификаторов `a`+`b` и `ab`", () => {
        const r = resolver({
            rules: [],
            semanticTokenRules: [
                { selector: "*.a", settings: { foreground: RED } },
                { selector: "*.ab", settings: { foreground: GREEN } },
            ],
        });
        expect(r.resolve("variable", ["a", "b"], "ts")?.fg).toBe(parseHexColor(RED));
        expect(r.resolve("variable", ["ab"], "ts")?.fg).toBe(parseHexColor(GREEN));
    });

    it("после dispose ни реестр, ни смена темы не трогают резолвер", () => {
        const registry = new TokenClassificationRegistry();
        const r = resolver(
            { rules: [], semanticTokenRules: [{ selector: "type", settings: { foreground: RED } }] },
            registry,
        );
        const listener = vi.fn();
        r.onDidChange(listener);
        expect(r.resolve("annotation", [], "java")).toBeNull();
        r.dispose();
        registry.registerTokenType("annotation", "", "type");
        // Кэш не сброшен: подписка на реестр снята.
        expect(r.resolve("annotation", [], "java")).toBeNull();
        r.setTheme({ rules: [] });
        expect(listener).not.toHaveBeenCalled();
    });

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
