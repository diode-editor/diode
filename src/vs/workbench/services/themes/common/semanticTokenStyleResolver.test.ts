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

describe("SemanticTokenStyleResolver: fallback to theme TextMate scopes", () => {
    it("a type gets the color of its probe from tokenColors", () => {
        const r = resolver({ rules: [{ scope: "variable", settings: { foreground: RED } }] });
        expect(r.resolve("variable", [], "ts")).toStrictEqual({ fg: parseHexColor(RED) });
    });

    it("probes in order: the first one that yields a color wins", () => {
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

    it("within a probe, the longer matching rule scope wins; on a tie, the later one", () => {
        const r = resolver({
            rules: [
                { scope: "entity.name.function", settings: { foreground: RED } },
                { scope: "entity.name", settings: { foreground: GREEN } },
                { scope: "entity.name.function", settings: { foreground: BLUE } },
            ],
        });
        expect(r.resolve("method", [], "ts")?.fg).toBe(parseHexColor(BLUE));
    });

    it("a rule's fontStyle sets all four flags; color and style are taken independently", () => {
        const r = resolver({
            rules: [
                { scope: "comment", settings: { foreground: RED } },
                { scope: "comment.line", settings: { fontStyle: "italic underline" } },
                { scope: "comment", settings: { fontStyle: "bold strikethrough" } },
            ],
        });
        // Probe `comment`: `comment.line` does not match it.
        expect(r.resolve("comment", [], "ts")).toStrictEqual({
            fg: parseHexColor(RED),
            bold: true,
            italic: false,
            underline: false,
            strikethrough: true,
        });
    });

    it("a rule without scope and an empty selector do not take part; an array scope counts each element", () => {
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

    it("a TM selector with an exclusion and a parent parses as upstream", () => {
        const r = resolver({
            rules: [
                { scope: "string -string.quoted", settings: { foreground: RED } },
                { scope: "source keyword.control", settings: { foreground: GREEN } },
            ],
        });
        expect(r.resolve("string", [], "ts")?.fg).toBe(parseHexColor(RED));
        // A single-scope path has no `source`, so the rule with a parent misses.
        expect(r.resolve("keyword", [], "ts")).toBeNull();
    });

    it("a path probe from semanticTokenScopes: all rule scopes are found in the path", () => {
        const registry = createDefaultTokenClassificationRegistry();
        registry.registerTokenStyleDefault(registry.parseTokenSelector("label"), {
            scopesToProbe: [["source", "entity.name.label"]],
        });
        const r = resolver({ rules: [{ scope: "source entity.name.label", settings: { foreground: RED } }] }, registry);
        expect(r.resolve("label", [], "ts")?.fg).toBe(parseHexColor(RED));
    });

    it("nothing found: null (the token does not override TextMate)", () => {
        expect(resolver({ rules: [] }).resolve("variable", [], "ts")).toBeNull();
        expect(resolver({ rules: [] }).resolve("unknownType", ["x"], "ts")).toBeNull();
    });

    it("a more specific default wins: variable.readonly → variable.other.constant", () => {
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

describe("SemanticTokenStyleResolver: theme semanticTokenColors", () => {
    it("a theme rule overrides the fallback for the attributes it sets and seals them", () => {
        const r = resolver({
            rules: [{ scope: "variable", settings: { foreground: RED, fontStyle: "italic" } }],
            semanticTokenRules: [{ selector: "variable", settings: { foreground: GREEN } }],
        });
        // Color comes from semanticTokenColors, flags from the fallback (the theme rule did not set them).
        expect(r.resolve("variable", [], "ts")).toStrictEqual({
            fg: parseHexColor(GREEN),
            bold: false,
            italic: true,
            underline: false,
            strikethrough: false,
        });
    });

    it("a theme rule with a lower weight still beats a default with a higher one", () => {
        const r = resolver({
            rules: [{ scope: "variable.other.constant", settings: { foreground: RED } }],
            semanticTokenRules: [{ selector: "*", settings: { foreground: GREEN } }],
        });
        expect(r.resolve("variable", ["readonly"], "ts")?.fg).toBe(parseHexColor(GREEN));
    });

    it("among theme rules: the higher weight wins, on a tie the later one", () => {
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

    it("a later repeat of a selector overrides only its own attributes (include chain)", () => {
        const r = resolver({
            rules: [],
            semanticTokenRules: [
                { selector: "variable", settings: { foreground: RED, bold: true } },
                { selector: "variable", settings: { foreground: GREEN } },
            ],
        });
        expect(r.resolve("variable", [], "ts")).toStrictEqual({ fg: parseHexColor(GREEN), bold: true });
    });

    it("a rule's fontStyle overrides individual booleans, an empty one resets all", () => {
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

    it("a language rule applies only to its own language", () => {
        const r = resolver({
            rules: [],
            semanticTokenRules: [{ selector: "method:java", settings: { foreground: RED } }],
        });
        expect(r.resolve("method", [], "java")?.fg).toBe(parseHexColor(RED));
        expect(r.resolve("method", [], "ts")).toBeNull();
    });
});

describe("SemanticTokenStyleResolver: matching TM rules by probe (upstream resolveScopes)", () => {
    function probing(probes: string[][], selector = "t") {
        const registry = new TokenClassificationRegistry();
        registry.registerTokenStyleDefault(registry.parseTokenSelector(selector), { scopesToProbe: probes });
        return registry;
    }

    it("a rule of several identifiers requires each one to be found, even with a long probe", () => {
        const r = resolver(
            { rules: [{ scope: "meta.x entity.name", settings: { foreground: RED } }] },
            probing([["source", "entity.name.label"]]),
        );
        expect(r.resolve("t", [], "x")).toBeNull();
    });

    it("one probe scope does not count for two rule identifiers", () => {
        const r = resolver(
            { rules: [{ scope: "string string", settings: { foreground: RED } }] },
            probing([["string"]]),
        );
        expect(r.resolve("t", [], "x")).toBeNull();
    });

    it("weight by position in the probe outranks identifier length", () => {
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

    it("a prefix matches only on a dot boundary", () => {
        const r = resolver(
            { rules: [{ scope: "variable.other.read", settings: { foreground: RED } }] },
            probing([["variable.other.readwrite"]]),
        );
        expect(r.resolve("t", [], "x")).toBeNull();
    });

    it("a rule without scope (theme global settings) matches nothing", () => {
        const r = resolver({ rules: [{ settings: { foreground: RED } }] }, probing([["undefined"]]));
        expect(r.resolve("t", [], "x")).toBeNull();
    });

    it("a negation gives weight 0, and such a rule still applies", () => {
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

    it("fontStyle: the higher weight wins, on a tie the later one; a rule without fontStyle does not erase it", () => {
        const r = resolver(
            {
                rules: [
                    { scope: "comment.line", settings: { fontStyle: "italic" } },
                    { scope: "comment", settings: { fontStyle: "bold" } },
                    // Same weight as `italic` and later, but sets no fontStyle.
                    { scope: "comment.line", settings: { foreground: RED } },
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

    it("a probe that yields only fontStyle is already the answer: the next probe is not consulted", () => {
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

    it("a default with the `*` selector (weight 0) applies", () => {
        const r = resolver({ rules: [{ scope: "string", settings: { foreground: RED } }] }, probing([["string"]], "*"));
        expect(r.resolve("anything", [], "x")?.fg).toBe(parseHexColor(RED));
    });
});

describe("SemanticTokenStyleResolver: attribute weights", () => {
    it("a theme rule set only a flag: the color is filled in from the fallback", () => {
        const r = resolver({
            rules: [{ scope: "variable", settings: { foreground: GREEN } }],
            semanticTokenRules: [{ selector: "variable", settings: { bold: true } }],
        });
        expect(r.resolve("variable", [], "ts")).toStrictEqual({ fg: parseHexColor(GREEN), bold: true });
    });

    it("a flag from a higher-weight rule is not overridden by a later lower-weight rule", () => {
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

describe("SemanticTokenStyleResolver: lifecycle", () => {
    it("the cache key tells apart modifier sets `a`+`b` and `ab`", () => {
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

    it("after dispose neither the registry nor a theme change touch the resolver", () => {
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
        // Cache not reset: the registry subscription is gone.
        expect(r.resolve("annotation", [], "java")).toBeNull();
        r.setTheme({ rules: [] });
        expect(listener).not.toHaveBeenCalled();
    });

    it("semanticHighlighting comes from the active theme", () => {
        const r = resolver({ rules: [], semanticHighlighting: true });
        expect(r.semanticHighlighting).toBe(true);
        r.setTheme({ rules: [] });
        expect(r.semanticHighlighting).toBe(false);
    });

    it("a theme change resets the cache and fires onDidChange", () => {
        const r = resolver({ rules: [{ scope: "variable", settings: { foreground: RED } }] });
        const listener = vi.fn();
        r.onDidChange(listener);
        expect(r.resolve("variable", [], "ts")?.fg).toBe(parseHexColor(RED));
        r.setTheme({ rules: [{ scope: "variable", settings: { foreground: GREEN } }] });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(r.resolve("variable", [], "ts")?.fg).toBe(parseHexColor(GREEN));
    });

    it("cache by (type, modifier set, language): modifier order does not matter, language does", () => {
        const r = resolver({
            rules: [],
            semanticTokenRules: [{ selector: "variable.readonly.static:java", settings: { foreground: RED } }],
        });
        const first = r.resolve("variable", ["readonly", "static"], "java");
        expect(r.resolve("variable", ["static", "readonly"], "java")).toBe(first);
        expect(r.resolve("variable", ["static", "readonly"], "ts")).toBeNull();
    });

    it("a classification change rebuilds the theme rules and fires onDidChange; dispose unsubscribes", () => {
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

describe("SemanticTokenStyleResolver: built-in Dark Modern", () => {
    const theme = WorkbenchTheme.fromThemeFile(darkModernTheme).tokenTheme;
    const r = resolver(theme);

    it("the theme enables semantic highlighting", () => {
        expect(r.semanticHighlighting).toBe(true);
    });

    it("parameter, property, class, function: Dark+ colors via the fallback", () => {
        expect(r.resolve("parameter", [], "java")?.fg).toBe(parseHexColor("#9CDCFE"));
        expect(r.resolve("property", [], "java")?.fg).toBe(parseHexColor("#9CDCFE"));
        expect(r.resolve("class", [], "java")?.fg).toBe(parseHexColor("#4EC9B0"));
        expect(r.resolve("method", [], "java")?.fg).toBe(parseHexColor("#DCDCAA"));
        expect(r.resolve("variable", ["readonly"], "java")?.fg).toBe(parseHexColor("#4FC1FF"));
    });

    it("theme semanticTokenColors: newOperator comes from Dark+, which overrode Dark VS", () => {
        expect(r.resolve("newOperator", [], "cpp")?.fg).toBe(parseHexColor("#C586C0"));
    });
});
