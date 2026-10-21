import { describe, expect, it, vi } from "vitest";

import {
    createDefaultTokenClassificationRegistry,
    parseClassifierString,
    TokenClassificationRegistry,
} from "./tokenClassificationRegistry.ts";

describe("parseClassifierString", () => {
    it("right to left: language after `:`, modifiers after `.`, the rest is the type", () => {
        expect(parseClassifierString("variable.readonly.static:java")).toEqual({
            type: "variable",
            modifiers: ["static", "readonly"],
            language: "java",
        });
    });

    it("no language: the default language; no modifiers: an empty list", () => {
        expect(parseClassifierString("class", "ts")).toEqual({ type: "class", modifiers: [], language: "ts" });
        expect(parseClassifierString("*.declaration")).toEqual({
            type: "*",
            modifiers: ["declaration"],
            language: undefined,
        });
    });
});

describe("TokenClassificationRegistry: selectors and weight", () => {
    function registry(): TokenClassificationRegistry {
        const r = new TokenClassificationRegistry();
        r.registerTokenType("type", "");
        r.registerTokenType("class", "", "type");
        r.registerTokenType("record", "", "class");
        r.registerTokenModifier("readonly", "");
        return r;
    }

    it("type: 100 minus the level in the superType hierarchy; an unrelated type is -1", () => {
        const r = registry();
        expect(r.parseTokenSelector("record").match("record", [], "java")).toBe(100);
        expect(r.parseTokenSelector("class").match("record", [], "java")).toBe(99);
        expect(r.parseTokenSelector("type").match("record", [], "java")).toBe(98);
        expect(r.parseTokenSelector("record").match("class", [], "java")).toBe(-1);
    });

    it("a type unknown to the registry matches only itself", () => {
        const r = registry();
        expect(r.parseTokenSelector("macro").match("macro", [], "c")).toBe(100);
        expect(r.parseTokenSelector("type").match("macro", [], "c")).toBe(-1);
    });

    it("`*` matches any type with weight 0; each modifier is +100 and required", () => {
        const r = registry();
        expect(r.parseTokenSelector("*").match("anything", [], "x")).toBe(0);
        expect(r.parseTokenSelector("*.readonly").match("class", ["readonly"], "x")).toBe(100);
        expect(r.parseTokenSelector("class.readonly").match("class", ["static", "readonly"], "x")).toBe(200);
        expect(r.parseTokenSelector("class.readonly.static").match("class", ["readonly"], "x")).toBe(-1);
    });

    it("language: a match is +10, a mismatch is -1; the argument language acts like the one in the string", () => {
        const r = registry();
        expect(r.parseTokenSelector("class:java").match("class", [], "java")).toBe(110);
        expect(r.parseTokenSelector("class:java").match("class", [], "ts")).toBe(-1);
        expect(r.parseTokenSelector("class", "java").match("class", [], "java")).toBe(110);
        expect(r.parseTokenSelector("class", "java").match("class", [], "ts")).toBe(-1);
    });

    it("an empty type is the $invalid selector that matches nothing", () => {
        const selector = registry().parseTokenSelector(".readonly");
        expect(selector.id).toBe("$invalid");
        expect(selector.match("class", ["readonly"], "x")).toBe(-1);
    });

    it("selector id: type, modifiers in alphabetical order, language", () => {
        const r = registry();
        expect(r.parseTokenSelector("class.static.readonly:java").id).toBe("class.readonly.static:java");
        expect(r.parseTokenSelector("class").id).toBe("class");
    });

    it("the hierarchy is recomputed after registering and removing a type", () => {
        const r = new TokenClassificationRegistry();
        const selector = r.parseTokenSelector("type");
        expect(selector.match("annotation", [], "java")).toBe(-1);
        r.registerTokenType("annotation", "", "type");
        expect(selector.match("annotation", [], "java")).toBe(99);
        r.deregisterTokenType("annotation");
        expect(selector.match("annotation", [], "java")).toBe(-1);
    });

    it("a superType cycle does not hang matching", () => {
        const r = new TokenClassificationRegistry();
        r.registerTokenType("a", "", "b");
        r.registerTokenType("b", "", "a");
        expect(r.parseTokenSelector("b").match("a", [], "x")).toBe(99);
        expect(r.parseTokenSelector("c").match("a", [], "x")).toBe(-1);
    });
});

describe("TokenClassificationRegistry: registration", () => {
    it("invalid type, superType and modifier ids throw", () => {
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

    it("types and modifiers: registration, listing, removal", () => {
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

    it("default rules: in registration order, removal by selector id", () => {
        const r = new TokenClassificationRegistry();
        r.registerTokenStyleDefault(r.parseTokenSelector("a"), { scopesToProbe: [["x"]] });
        r.registerTokenStyleDefault(r.parseTokenSelector("b"), { scopesToProbe: [["y"]] });
        r.registerTokenStyleDefault(r.parseTokenSelector("a"), { scopesToProbe: [["z"]] });
        expect(r.getTokenStylingDefaultRules().map((rule) => rule.selector.id)).toEqual(["a", "b", "a"]);
        r.deregisterTokenStyleDefault(r.parseTokenSelector("a"));
        expect(r.getTokenStylingDefaultRules().map((rule) => rule.defaults.scopesToProbe)).toEqual([[["y"]]]);
    });

    it("every registry change fires onDidChange", () => {
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

describe("createDefaultTokenClassificationRegistry: verbatim from upstream", () => {
    const registry = createDefaultTokenClassificationRegistry();

    it("standard types with descriptions and superType", () => {
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
        expect(types.map((t) => t.description)).toEqual([
            "Style for comments.",
            "Style for strings.",
            "Style for keywords.",
            "Style for numbers.",
            "Style for expressions.",
            "Style for operators.",
            "Style for namespaces.",
            "Style for types.",
            "Style for structs.",
            "Style for classes.",
            "Style for interfaces.",
            "Style for enums.",
            "Style for type parameters.",
            "Style for functions",
            "Style for member functions",
            "Style for method (member functions)",
            "Style for macros.",
            "Style for variables.",
            "Style for parameters.",
            "Style for properties.",
            "Style for enum members.",
            "Style for events.",
            "Style for decorators & annotations.",
            "Style for labels. ",
        ]);
    });

    it("standard modifiers", () => {
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

    it("fallbacks 'selector → TextMate scopes'", () => {
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

    it("member is a subtype of method: the method selector matches with weight 99", () => {
        expect(registry.parseTokenSelector("method").match("member", [], "ts")).toBe(99);
    });
});
