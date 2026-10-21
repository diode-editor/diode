import { describe, expect, it } from "vitest";

import {
    type ContextKeyExpression,
    type ContextKeyValue,
    deserializeWhen,
    evaluateWhen,
    type IContext,
    parseWhen,
    serializeWhen,
    whenKeys,
    whenPositiveKeys,
} from "./contextKeyExpr.ts";

function context(values: Record<string, ContextKeyValue>): IContext {
    return { getValue: (key) => (Object.hasOwn(values, key) ? values[key] : undefined) };
}

function evaluate(when: string, values: Record<string, ContextKeyValue> = {}): boolean {
    const expr = parseWhen(when);
    if (expr === undefined) throw new Error(`failed to parse: ${when}`);
    return evaluateWhen(expr, context(values));
}

/** Canonical form of the parsed string, or `undefined` on error. */
function canon(when: string): string | undefined {
    const expr = parseWhen(when);
    return expr === undefined ? undefined : serializeWhen(expr);
}

describe("parseWhen — tree", () => {
    it("key, literals, negation", () => {
        expect(parseWhen(" foo")).toEqual({ type: "defined", key: "foo" });
        expect(parseWhen("true")).toEqual({ type: "true" });
        expect(parseWhen("false")).toEqual({ type: "false" });
        expect(parseWhen("!foo")).toEqual({ type: "not", expr: { type: "defined", key: "foo" } });
        expect(parseWhen("!true")).toEqual({ type: "false" });
        expect(parseWhen("!false")).toEqual({ type: "true" });
        expect(parseWhen("!(a || b)")).toEqual({
            type: "not",
            expr: {
                type: "or",
                exprs: [
                    { type: "defined", key: "a" },
                    { type: "defined", key: "b" },
                ],
            },
        });
    });

    it("precedence: && binds tighter than ||, parentheses change it", () => {
        const a = { type: "defined", key: "a" } as const;
        const b = { type: "defined", key: "b" } as const;
        const c = { type: "defined", key: "c" } as const;
        expect(parseWhen("a && b || c")).toEqual({ type: "or", exprs: [{ type: "and", exprs: [a, b] }, c] });
        expect(parseWhen("a && (b || c)")).toEqual({ type: "and", exprs: [a, { type: "or", exprs: [b, c] }] });
        expect(parseWhen("a || b || c")).toEqual({ type: "or", exprs: [a, b, c] });
        expect(parseWhen("((a))")).toEqual(a);
    });

    it("equality: an unquoted value is a string; `== true` folds into the key, `== 'true'` does not", () => {
        expect(parseWhen("editorLangId == java")).toEqual({ type: "equals", key: "editorLangId", value: "java" });
        expect(parseWhen("resourceExtname == .ts")).toEqual({ type: "equals", key: "resourceExtname", value: ".ts" });
        expect(parseWhen("a != 'x y'")).toEqual({ type: "notEquals", key: "a", value: "x y" });
        expect(parseWhen("a == true")).toEqual({ type: "defined", key: "a" });
        expect(parseWhen("a == false")).toEqual({ type: "not", expr: { type: "defined", key: "a" } });
        expect(parseWhen("a != true")).toEqual({ type: "not", expr: { type: "defined", key: "a" } });
        expect(parseWhen("a != false")).toEqual({ type: "defined", key: "a" });
        expect(parseWhen("a == 'true'")).toEqual({ type: "equals", key: "a", value: "true" });
        expect(parseWhen("a != 'false'")).toEqual({ type: "notEquals", key: "a", value: "false" });
        // `in` and an empty right-hand side: existing extensions write it this way.
        expect(parseWhen("a == in")).toEqual({ type: "equals", key: "a", value: "in" });
        expect(parseWhen("a == ")).toEqual({ type: "equals", key: "a", value: "" });
        expect(parseWhen("a == && b")).toEqual({
            type: "and",
            exprs: [
                { type: "equals", key: "a", value: "" },
                { type: "defined", key: "b" },
            ],
        });
    });

    it("comparisons: number from parseFloat, otherwise string", () => {
        expect(parseWhen("macKeys >= 2")).toEqual({ type: "greaterEquals", key: "macKeys", value: 2 });
        expect(parseWhen("a > -1.5")).toEqual({ type: "greater", key: "a", value: -1.5 });
        expect(parseWhen("a < 3")).toEqual({ type: "smaller", key: "a", value: 3 });
        expect(parseWhen("a <= x")).toEqual({ type: "smallerEquals", key: "a", value: "x" });
    });

    it("in / not in", () => {
        expect(parseWhen("resource in list")).toEqual({ type: "in", key: "resource", valueKey: "list" });
        expect(parseWhen("resource not in 'list'")).toEqual({ type: "notIn", key: "resource", valueKey: "list" });
        // Keywords on the right-hand side are plain names.
        expect(parseWhen("a in true")).toEqual({ type: "in", key: "a", valueKey: "true" });
        expect(parseWhen("a not in false")).toEqual({ type: "notIn", key: "a", valueKey: "false" });
    });

    it("regex: g and y flags are stripped", () => {
        const expr = parseWhen("resourcePath =~ /\\.md$/giy");
        expect(expr).toMatchObject({ type: "regex", key: "resourcePath" });
        const regexp = (expr as Extract<ContextKeyExpression, { type: "regex" }>).regexp;
        expect(regexp.source).toBe("\\.md$");
        expect(regexp.flags).toBe("i");
    });
});

describe("parseWhen — errors give undefined", () => {
    it.each([
        ["", "empty string"],
        ["a = b", "lexical error"],
        ["foo && 'bar", "unclosed quote"],
        ["/foo", "unclosed regex without a key"],
        ["!b == 'true'", "negation only applies to a key, literal or parentheses"],
        ["!!foo", "double negation"],
        ["!", "negation without an operand"],
        ["!foo &&  in bar", "in in place of a term"],
        ["a &&  && b", "empty operand"],
        ["(a", "unclosed parenthesis"],
        ["!(a", "unclosed parenthesis under negation"],
        ["a)", "extra parenthesis"],
        ["viewItem == VSCode WorkSpace", "unquoted two-word value"],
        ["a not b", "not without in"],
        ["a =~ 'x'", "regex must be /…/"],
        ["a =~ /(/", "broken regex"],
        ["a &&", "truncated expression"],
        ["!&& && b", "operator after negation"],
        ["! && b", "negation without an operand before &&"],
        ["&& && b", "operator in place of a term"],
        ["a =~ '/x/'", "quoted regex (old upstream form) is rejected"],
        ["a =~ b", "not a regex after =~"],
        ["a == 'x' 'y'", "two right-hand sides"],
    ])("%s — %s", (when) => {
        expect(parseWhen(when)).toBeUndefined();
    });
});

describe("evaluateWhen — node semantics as upstream", () => {
    it("key is the truthiness of its value; an unknown key is undefined, no exceptions", () => {
        expect(evaluate("a", { a: true })).toBe(true);
        expect(evaluate("a", { a: "x" })).toBe(true);
        expect(evaluate("a", { a: 0 })).toBe(false);
        expect(evaluate("a")).toBe(false);
        expect(evaluate("!a")).toBe(true);
        expect(evaluate("!a", { a: true })).toBe(false);
        // Names from the global object are ordinary unknown keys.
        expect(evaluate("constructor")).toBe(false);
        expect(evaluate("toString")).toBe(false);
    });

    it("literals", () => {
        expect(evaluate("true")).toBe(true);
        expect(evaluate("false")).toBe(false);
        // A literal ignores the context, even one that answers true to anything.
        const truthy: IContext = { getValue: () => true };
        expect(evaluateWhen(parseWhen("false")!, truthy)).toBe(false);
        expect(evaluateWhen(parseWhen("!true")!, truthy)).toBe(false);
        expect(evaluate("!(a && b)", { a: true, b: false })).toBe(true);
        expect(evaluate("!(a && b)", { a: true, b: true })).toBe(false);
    });

    it("== and != are loose: a number equals its string", () => {
        expect(evaluate("macKeys == 2", { macKeys: 2 })).toBe(true);
        expect(evaluate("tier == 'kitty'", { tier: "kitty" })).toBe(true);
        expect(evaluate("tier == kitty", { tier: "legacy" })).toBe(false);
        expect(evaluate("tier != 'kitty'", { tier: "legacy" })).toBe(true);
        expect(evaluate("tier != 'kitty'", { tier: "kitty" })).toBe(false);
        expect(evaluate("editorLangId == java", { editorLangId: "java" })).toBe(true);
    });

    it("comparisons: parseFloat of the value; a string right-hand side is always false", () => {
        expect(evaluate("macKeys >= 2", { macKeys: 2 })).toBe(true);
        expect(evaluate("macKeys >= 2", { macKeys: 1 })).toBe(false);
        expect(evaluate("macKeys > 2", { macKeys: 2 })).toBe(false);
        expect(evaluate("macKeys > 2", { macKeys: "3" })).toBe(true);
        expect(evaluate("macKeys < 2", { macKeys: 1 })).toBe(true);
        expect(evaluate("macKeys < 2", { macKeys: 2 })).toBe(false);
        expect(evaluate("macKeys <= 2", { macKeys: 2 })).toBe(true);
        expect(evaluate("macKeys <= 2", { macKeys: 3 })).toBe(false);
        expect(evaluate("macKeys < 2")).toBe(false); // NaN
        expect(evaluate("a < x", { a: 1 })).toBe(false);
        expect(evaluate("a > x", { a: 1 })).toBe(false);
        expect(evaluate("a >= x", { a: 1 })).toBe(false);
        expect(evaluate("a <= x", { a: 1 })).toBe(false);
    });

    it("regex tests the string value", () => {
        expect(evaluate("r =~ /\\.ts$/", { r: "a.ts" })).toBe(true);
        expect(evaluate("r =~ /\\.ts$/", { r: "a.js" })).toBe(false);
        expect(evaluate("r =~ /^A/i", { r: "abc" })).toBe(true);
        expect(evaluate("r =~ /^undefined$/")).toBe(true); // like upstream: test(undefined)
        // Arrays and objects (values for `in`) have no text.
        expect(evaluate("r =~ /^$/", { r: ["a"] })).toBe(true);
        expect(evaluate("r =~ /a/", { r: { a: 1 } })).toBe(false);
        expect(evaluate("n >= 0", { n: [1] })).toBe(false);
    });

    it("in / not in: array — includes, object — own property", () => {
        expect(evaluate("x in list", { x: "b", list: ["a", "b"] })).toBe(true);
        expect(evaluate("x in list", { x: "c", list: ["a", "b"] })).toBe(false);
        expect(evaluate("x in map", { x: "b", map: { b: 1 } })).toBe(true);
        expect(evaluate("x in map", { x: "toString", map: { b: 1 } })).toBe(false);
        expect(evaluate("x in map", { x: 1, map: { 1: 1 } })).toBe(false); // an object key is always a string
        expect(evaluate("x in list", { x: "a", list: "abc" })).toBe(false);
        expect(evaluate("x in list", { x: "a" })).toBe(false);
        expect(evaluate("x not in list", { x: "c", list: ["a"] })).toBe(true);
        expect(evaluate("x not in list", { x: "a", list: ["a"] })).toBe(false);
    });

    it("&& and ||", () => {
        expect(evaluate("a && b", { a: true, b: true })).toBe(true);
        expect(evaluate("a && b", { a: true })).toBe(false);
        expect(evaluate("a || b", { b: true })).toBe(true);
        expect(evaluate("a || b")).toBe(false);
    });

    it("dotted and hyphenated keys are read as a whole", () => {
        expect(evaluate("supermaven.isProUser", { "supermaven.isProUser": true })).toBe(true);
        expect(evaluate("foo-bar && 2fa", { "foo-bar": true, "2fa": true })).toBe(true);
    });
});

describe("serializeWhen — canonical form", () => {
    it("strips parentheses and spaces, sorts operands", () => {
        expect(canon("b && a")).toBe("a && b");
        expect(canon("(a)&&b")).toBe("a && b");
        expect(canon("a && (b && c)")).toBe("a && b && c");
        expect(canon("c || (b || a)")).toBe("a || b || c");
        // A nested node is flattened before sorting rather than sorted as a whole.
        expect(canon("b && (a && c)")).toBe("a && b && c");
        expect(canon("b || (a || c)")).toBe("a || b || c");
        expect(canon("c || a && b")).toBe("a && b || c");
        expect(canon("(b || a) && c")).toBe("(a || b) && c");
    });

    it("every node", () => {
        expect(canon("true")).toBe("true");
        expect(canon("false")).toBe("false");
        expect(canon("!a")).toBe("!a");
        expect(canon("!(a || b)")).toBe("!(a || b)");
        expect(canon("a == x")).toBe("a == 'x'");
        expect(canon("a != 'x'")).toBe("a != 'x'");
        expect(canon("a > 1")).toBe("a > 1");
        expect(canon("a >= 1")).toBe("a >= 1");
        expect(canon("a < 1")).toBe("a < 1");
        expect(canon("a <= x")).toBe("a <= x");
        expect(canon("a =~ /x/i")).toBe("a =~ /x/i");
        expect(canon("a in b")).toBe("a in 'b'");
        expect(canon("a not in b")).toBe("a not in 'b'");
    });
});

describe("whenKeys", () => {
    it("all keys of the expression without duplicates, including the right side of in", () => {
        expect(whenKeys(parseWhen("a && !b || c == x && a")!)).toEqual(["a", "b", "c"]);
        expect(whenKeys(parseWhen("x in list && y not in other")!)).toEqual(["x", "list", "y", "other"]);
        expect(whenKeys(parseWhen("true || false || !false")!)).toEqual([]);
        expect(whenKeys(parseWhen("r =~ /x/ && n > 1")!)).toEqual(["r", "n"]);
    });
});

describe("whenPositiveKeys", () => {
    it("keys not under negation", () => {
        expect(whenPositiveKeys(parseWhen("a && !b || c == x")!)).toEqual(["a", "c"]);
        expect(whenPositiveKeys(parseWhen("!(a && !b)")!)).toEqual(["b"]);
        expect(whenPositiveKeys(parseWhen("n > 1 && r =~ /x/ && i in list")!)).toEqual(["n", "r", "i"]);
        expect(whenPositiveKeys(parseWhen("i not in list || true || false")!)).toEqual([]);
        expect(whenPositiveKeys(parseWhen("a != x")!)).toEqual(["a"]);
    });
});

describe("deserializeWhen — cache by string", () => {
    it("one string gives the same tree object; an error is cached too", () => {
        const first = deserializeWhen("cacheProbeA && cacheProbeB");
        expect(first).toEqual(parseWhen("cacheProbeA && cacheProbeB"));
        expect(deserializeWhen("cacheProbeA && cacheProbeB")).toBe(first);
        expect(deserializeWhen("cacheProbe = broken")).toBeUndefined();
        expect(deserializeWhen("cacheProbe = broken")).toBeUndefined();
    });
});
