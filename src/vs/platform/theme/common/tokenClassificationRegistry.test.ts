import { describe, expect, it, vi } from "vitest";

import {
    createDefaultTokenClassificationRegistry,
    parseClassifierString,
    TokenClassificationRegistry,
} from "./tokenClassificationRegistry.ts";

describe("parseClassifierString", () => {
    it("справа налево: язык после `:`, модификаторы после `.`, остаток — тип", () => {
        expect(parseClassifierString("variable.readonly.static:java")).toEqual({
            type: "variable",
            modifiers: ["static", "readonly"],
            language: "java",
        });
    });

    it("без языка — язык по умолчанию; без модификаторов — пустой список", () => {
        expect(parseClassifierString("class", "ts")).toEqual({ type: "class", modifiers: [], language: "ts" });
        expect(parseClassifierString("*.declaration")).toEqual({
            type: "*",
            modifiers: ["declaration"],
            language: undefined,
        });
    });
});

describe("TokenClassificationRegistry — селекторы и вес", () => {
    function registry(): TokenClassificationRegistry {
        const r = new TokenClassificationRegistry();
        r.registerTokenType("type", "");
        r.registerTokenType("class", "", "type");
        r.registerTokenType("record", "", "class");
        r.registerTokenModifier("readonly", "");
        return r;
    }

    it("тип: 100 минус уровень в иерархии superType; чужой тип — -1", () => {
        const r = registry();
        expect(r.parseTokenSelector("record").match("record", [], "java")).toBe(100);
        expect(r.parseTokenSelector("class").match("record", [], "java")).toBe(99);
        expect(r.parseTokenSelector("type").match("record", [], "java")).toBe(98);
        expect(r.parseTokenSelector("record").match("class", [], "java")).toBe(-1);
    });

    it("тип, неизвестный реестру, совпадает только сам с собой", () => {
        const r = registry();
        expect(r.parseTokenSelector("macro").match("macro", [], "c")).toBe(100);
        expect(r.parseTokenSelector("type").match("macro", [], "c")).toBe(-1);
    });

    it("`*` совпадает с любым типом с весом 0; каждый модификатор +100 и обязателен", () => {
        const r = registry();
        expect(r.parseTokenSelector("*").match("anything", [], "x")).toBe(0);
        expect(r.parseTokenSelector("*.readonly").match("class", ["readonly"], "x")).toBe(100);
        expect(r.parseTokenSelector("class.readonly").match("class", ["static", "readonly"], "x")).toBe(200);
        expect(r.parseTokenSelector("class.readonly.static").match("class", ["readonly"], "x")).toBe(-1);
    });

    it("язык: совпал — +10, не совпал — -1; язык из аргумента действует как в строке", () => {
        const r = registry();
        expect(r.parseTokenSelector("class:java").match("class", [], "java")).toBe(110);
        expect(r.parseTokenSelector("class:java").match("class", [], "ts")).toBe(-1);
        expect(r.parseTokenSelector("class", "java").match("class", [], "java")).toBe(110);
        expect(r.parseTokenSelector("class", "java").match("class", [], "ts")).toBe(-1);
    });

    it("пустой тип — селектор $invalid, не совпадающий ни с чем", () => {
        const selector = registry().parseTokenSelector(".readonly");
        expect(selector.id).toBe("$invalid");
        expect(selector.match("class", ["readonly"], "x")).toBe(-1);
    });

    it("id селектора: тип, модификаторы по алфавиту, язык", () => {
        const r = registry();
        expect(r.parseTokenSelector("class.static.readonly:java").id).toBe("class.readonly.static:java");
        expect(r.parseTokenSelector("class").id).toBe("class");
    });

    it("иерархия пересчитывается после регистрации и снятия типа", () => {
        const r = new TokenClassificationRegistry();
        const selector = r.parseTokenSelector("type");
        expect(selector.match("annotation", [], "java")).toBe(-1);
        r.registerTokenType("annotation", "", "type");
        expect(selector.match("annotation", [], "java")).toBe(99);
        r.deregisterTokenType("annotation");
        expect(selector.match("annotation", [], "java")).toBe(-1);
    });

    it("цикл в superType не вешает матч", () => {
        const r = new TokenClassificationRegistry();
        r.registerTokenType("a", "", "b");
        r.registerTokenType("b", "", "a");
        expect(r.parseTokenSelector("b").match("a", [], "x")).toBe(99);
        expect(r.parseTokenSelector("c").match("a", [], "x")).toBe(-1);
    });
});

describe("TokenClassificationRegistry — регистрация", () => {
    it("невалидные id типа, superType и модификатора — исключение", () => {
        const r = new TokenClassificationRegistry();
        expect(() => {
            r.registerTokenType("bad id", "");
        }).toThrow("Invalid token type id.");
        expect(() => {
            r.registerTokenType("ok", "", "bad id");
        }).toThrow("Invalid token super type id.");
        expect(() => {
            r.registerTokenModifier("bad.id", "");
        }).toThrow("Invalid token modifier id.");
        expect(() => {
            r.registerTokenType("ok", "", "");
        }).not.toThrow();
        expect(r.getTokenTypes()).toEqual([
            { id: "ok", superType: "", description: "", deprecationMessage: undefined },
        ]);
    });

    it("типы и модификаторы: регистрация, перечисление, снятие", () => {
        const r = new TokenClassificationRegistry();
        r.registerTokenType("t", "desc", "u", "old");
        r.registerTokenModifier("m", "mod", "gone");
        expect(r.getTokenTypes()).toEqual([
            { id: "t", superType: "u", description: "desc", deprecationMessage: "old" },
        ]);
        expect(r.getTokenModifiers()).toEqual([{ id: "m", description: "mod", deprecationMessage: "gone" }]);
        r.deregisterTokenType("t");
        r.deregisterTokenModifier("m");
        expect(r.getTokenTypes()).toEqual([]);
        expect(r.getTokenModifiers()).toEqual([]);
    });

    it("дефолтные правила: в порядке регистрации, снятие — по id селектора", () => {
        const r = new TokenClassificationRegistry();
        r.registerTokenStyleDefault(r.parseTokenSelector("a"), { scopesToProbe: [["x"]] });
        r.registerTokenStyleDefault(r.parseTokenSelector("b"), { scopesToProbe: [["y"]] });
        r.registerTokenStyleDefault(r.parseTokenSelector("a"), { scopesToProbe: [["z"]] });
        expect(r.getTokenStylingDefaultRules().map((rule) => rule.selector.id)).toEqual(["a", "b", "a"]);
        r.deregisterTokenStyleDefault(r.parseTokenSelector("a"));
        expect(r.getTokenStylingDefaultRules().map((rule) => rule.defaults.scopesToProbe)).toEqual([[["y"]]]);
    });

    it("каждое изменение реестра фаерит onDidChange", () => {
        const r = new TokenClassificationRegistry();
        const listener = vi.fn();
        r.onDidChange(listener);
        r.registerTokenType("t", "");
        r.registerTokenModifier("m", "");
        const selector = r.parseTokenSelector("t");
        r.registerTokenStyleDefault(selector, { scopesToProbe: [] });
        r.deregisterTokenStyleDefault(selector);
        r.deregisterTokenType("t");
        r.deregisterTokenModifier("m");
        expect(listener).toHaveBeenCalledTimes(6);
    });
});

describe("createDefaultTokenClassificationRegistry — дословно из эталона", () => {
    const registry = createDefaultTokenClassificationRegistry();

    it("стандартные типы с описаниями и superType", () => {
        const types = registry.getTokenTypes();
        expect(types.map((t) => t.id)).toEqual([
            "comment",
            "string",
            "keyword",
            "number",
            "regexp",
            "operator",
            "namespace",
            "type",
            "struct",
            "class",
            "interface",
            "enum",
            "typeParameter",
            "function",
            "member",
            "method",
            "macro",
            "variable",
            "parameter",
            "property",
            "enumMember",
            "event",
            "decorator",
            "label",
        ]);
        expect(types.find((t) => t.id === "member")).toEqual({
            id: "member",
            description: "Style for member functions",
            superType: "method",
            deprecationMessage: "Deprecated use `method` instead",
        });
        expect(types.find((t) => t.id === "label")?.description).toBe("Style for labels. ");
        expect(types.find((t) => t.id === "decorator")?.description).toBe("Style for decorators & annotations.");
    });

    it("стандартные модификаторы", () => {
        expect(registry.getTokenModifiers().map((m) => [m.id, m.description])).toEqual([
            ["declaration", "Style for all symbol declarations."],
            ["documentation", "Style to use for references in documentation."],
            ["static", "Style to use for symbols that are static."],
            ["abstract", "Style to use for symbols that are abstract."],
            ["deprecated", "Style to use for symbols that are deprecated."],
            ["modification", "Style to use for write accesses."],
            ["async", "Style to use for symbols that are async."],
            ["readonly", "Style to use for symbols that are read-only."],
        ]);
    });

    it("фоллбэки «селектор → TextMate-скоупы»", () => {
        expect(
            registry.getTokenStylingDefaultRules().map((rule) => [rule.selector.id, rule.defaults.scopesToProbe]),
        ).toEqual([
            ["comment", [["comment"]]],
            ["string", [["string"]]],
            ["keyword", [["keyword.control"]]],
            ["number", [["constant.numeric"]]],
            ["regexp", [["constant.regexp"]]],
            ["operator", [["keyword.operator"]]],
            ["namespace", [["entity.name.namespace"]]],
            ["type", [["entity.name.type"], ["support.type"]]],
            ["struct", [["entity.name.type.struct"]]],
            ["class", [["entity.name.type.class"], ["support.class"]]],
            ["interface", [["entity.name.type.interface"]]],
            ["enum", [["entity.name.type.enum"]]],
            ["typeParameter", [["entity.name.type.parameter"]]],
            ["function", [["entity.name.function"], ["support.function"]]],
            ["member", []],
            ["method", [["entity.name.function.member"], ["support.function"]]],
            ["macro", [["entity.name.function.preprocessor"]]],
            ["variable", [["variable.other.readwrite"], ["entity.name.variable"]]],
            ["parameter", [["variable.parameter"]]],
            ["property", [["variable.other.property"]]],
            ["enumMember", [["variable.other.enummember"]]],
            ["event", [["variable.other.event"]]],
            ["decorator", [["entity.name.decorator"], ["entity.name.function"]]],
            ["label", []],
            ["variable.readonly", [["variable.other.constant"]]],
            ["property.readonly", [["variable.other.constant.property"]]],
            ["type.defaultLibrary", [["support.type"]]],
            ["class.defaultLibrary", [["support.class"]]],
            ["interface.defaultLibrary", [["support.class"]]],
            ["variable.defaultLibrary", [["support.variable"], ["support.other.variable"]]],
            ["variable.defaultLibrary.readonly", [["support.constant"]]],
            ["property.defaultLibrary", [["support.variable.property"]]],
            ["property.defaultLibrary.readonly", [["support.constant.property"]]],
            ["function.defaultLibrary", [["support.function"]]],
            ["member.defaultLibrary", [["support.function"]]],
        ]);
    });

    it("member — подтип method: селектор method совпадает с весом 99", () => {
        expect(registry.parseTokenSelector("method").match("member", [], "ts")).toBe(99);
    });
});
