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
} from "./contextKeyExpr.ts";

function context(values: Record<string, ContextKeyValue>): IContext {
    return { getValue: (key) => (Object.hasOwn(values, key) ? values[key] : undefined) };
}

function evaluate(when: string, values: Record<string, ContextKeyValue> = {}): boolean {
    const expr = parseWhen(when);
    if (expr === undefined) throw new Error(`не разобралось: ${when}`);
    return evaluateWhen(expr, context(values));
}

/** Каноническая запись разобранной строки или `undefined` при ошибке. */
function canon(when: string): string | undefined {
    const expr = parseWhen(when);
    return expr === undefined ? undefined : serializeWhen(expr);
}

describe("parseWhen — дерево", () => {
    it("ключ, литералы, отрицание", () => {
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

    it("приоритет: && связывает сильнее ||, скобки его меняют", () => {
        const a = { type: "defined", key: "a" } as const;
        const b = { type: "defined", key: "b" } as const;
        const c = { type: "defined", key: "c" } as const;
        expect(parseWhen("a && b || c")).toEqual({ type: "or", exprs: [{ type: "and", exprs: [a, b] }, c] });
        expect(parseWhen("a && (b || c)")).toEqual({ type: "and", exprs: [a, { type: "or", exprs: [b, c] }] });
        expect(parseWhen("a || b || c")).toEqual({ type: "or", exprs: [a, b, c] });
        expect(parseWhen("((a))")).toEqual(a);
    });

    it("равенство: значение без кавычек — строка; `== true` сворачивается в ключ, `== 'true'` — нет", () => {
        expect(parseWhen("editorLangId == java")).toEqual({ type: "equals", key: "editorLangId", value: "java" });
        expect(parseWhen("resourceExtname == .ts")).toEqual({ type: "equals", key: "resourceExtname", value: ".ts" });
        expect(parseWhen("a != 'x y'")).toEqual({ type: "notEquals", key: "a", value: "x y" });
        expect(parseWhen("a == true")).toEqual({ type: "defined", key: "a" });
        expect(parseWhen("a == false")).toEqual({ type: "not", expr: { type: "defined", key: "a" } });
        expect(parseWhen("a != true")).toEqual({ type: "not", expr: { type: "defined", key: "a" } });
        expect(parseWhen("a != false")).toEqual({ type: "defined", key: "a" });
        expect(parseWhen("a == 'true'")).toEqual({ type: "equals", key: "a", value: "true" });
        expect(parseWhen("a != 'false'")).toEqual({ type: "notEquals", key: "a", value: "false" });
        // `in` и пустая правая часть — так пишут существующие расширения.
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

    it("сравнения: число из parseFloat, иначе строка", () => {
        expect(parseWhen("macKeys >= 2")).toEqual({ type: "greaterEquals", key: "macKeys", value: 2 });
        expect(parseWhen("a > -1.5")).toEqual({ type: "greater", key: "a", value: -1.5 });
        expect(parseWhen("a < 3")).toEqual({ type: "smaller", key: "a", value: 3 });
        expect(parseWhen("a <= x")).toEqual({ type: "smallerEquals", key: "a", value: "x" });
    });

    it("in / not in", () => {
        expect(parseWhen("resource in list")).toEqual({ type: "in", key: "resource", valueKey: "list" });
        expect(parseWhen("resource not in 'list'")).toEqual({ type: "notIn", key: "resource", valueKey: "list" });
        // Ключевые слова справа — просто имена.
        expect(parseWhen("a in true")).toEqual({ type: "in", key: "a", valueKey: "true" });
        expect(parseWhen("a not in false")).toEqual({ type: "notIn", key: "a", valueKey: "false" });
    });

    it("регекс: флаги g и y снимаются", () => {
        const expr = parseWhen("resourcePath =~ /\\.md$/giy");
        expect(expr).toMatchObject({ type: "regex", key: "resourcePath" });
        const regexp = (expr as Extract<ContextKeyExpression, { type: "regex" }>).regexp;
        expect(regexp.source).toBe("\\.md$");
        expect(regexp.flags).toBe("i");
    });
});

describe("parseWhen — ошибки дают undefined", () => {
    it.each([
        ["", "пустая строка"],
        ["a = b", "ошибка лексики"],
        ["foo && 'bar", "незакрытая кавычка"],
        ["/foo", "незакрытый регекс без ключа"],
        ["!b == 'true'", "отрицание только у ключа, литерала или скобок"],
        ["!!foo", "двойное отрицание"],
        ["!", "отрицание без операнда"],
        ["!foo &&  in bar", "in на месте терма"],
        ["a &&  && b", "пустой операнд"],
        ["(a", "незакрытая скобка"],
        ["!(a", "незакрытая скобка под отрицанием"],
        ["a)", "лишняя скобка"],
        ["viewItem == VSCode WorkSpace", "значение из двух слов без кавычек"],
        ["a not b", "not без in"],
        ["a =~ 'x'", "регекс должен быть /…/"],
        ["a =~ /(/", "битый регекс"],
        ["a &&", "оборванное выражение"],
        ["!&& && b", "оператор после отрицания"],
        ["! && b", "отрицание без операнда перед &&"],
        ["&& && b", "оператор на месте терма"],
        ["a =~ '/x/'", "регекс в кавычках (старая форма upstream) не принимается"],
        ["a =~ b", "после =~ — не регекс"],
        ["a == 'x' 'y'", "две правые части"],
    ])("%s — %s", (when) => {
        expect(parseWhen(when)).toBeUndefined();
    });
});

describe("evaluateWhen — семантика узлов как у upstream", () => {
    it("ключ — истинность значения; незнакомый ключ — undefined, без исключений", () => {
        expect(evaluate("a", { a: true })).toBe(true);
        expect(evaluate("a", { a: "x" })).toBe(true);
        expect(evaluate("a", { a: 0 })).toBe(false);
        expect(evaluate("a")).toBe(false);
        expect(evaluate("!a")).toBe(true);
        expect(evaluate("!a", { a: true })).toBe(false);
        // Имена из глобального объекта — обычные незнакомые ключи.
        expect(evaluate("constructor")).toBe(false);
        expect(evaluate("toString")).toBe(false);
    });

    it("литералы", () => {
        expect(evaluate("true")).toBe(true);
        expect(evaluate("false")).toBe(false);
        // Литерал не смотрит в контекст, даже если тот отвечает истиной на что угодно.
        const truthy: IContext = { getValue: () => true };
        expect(evaluateWhen(parseWhen("false")!, truthy)).toBe(false);
        expect(evaluateWhen(parseWhen("!true")!, truthy)).toBe(false);
        expect(evaluate("!(a && b)", { a: true, b: false })).toBe(true);
        expect(evaluate("!(a && b)", { a: true, b: true })).toBe(false);
    });

    it("== и != — нестрогие: число равно своей строке", () => {
        expect(evaluate("macKeys == 2", { macKeys: 2 })).toBe(true);
        expect(evaluate("tier == 'kitty'", { tier: "kitty" })).toBe(true);
        expect(evaluate("tier == kitty", { tier: "legacy" })).toBe(false);
        expect(evaluate("tier != 'kitty'", { tier: "legacy" })).toBe(true);
        expect(evaluate("tier != 'kitty'", { tier: "kitty" })).toBe(false);
        expect(evaluate("editorLangId == java", { editorLangId: "java" })).toBe(true);
    });

    it("сравнения: parseFloat от значения; строковая правая часть — всегда ложь", () => {
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

    it("регекс проверяет строковое значение", () => {
        expect(evaluate("r =~ /\\.ts$/", { r: "a.ts" })).toBe(true);
        expect(evaluate("r =~ /\\.ts$/", { r: "a.js" })).toBe(false);
        expect(evaluate("r =~ /^A/i", { r: "abc" })).toBe(true);
        expect(evaluate("r =~ /^undefined$/")).toBe(true); // как у upstream: test(undefined)
        // У массива и объекта (значения для `in`) текста нет.
        expect(evaluate("r =~ /^$/", { r: ["a"] })).toBe(true);
        expect(evaluate("r =~ /a/", { r: { a: 1 } })).toBe(false);
        expect(evaluate("n >= 0", { n: [1] })).toBe(false);
    });

    it("in / not in: массив — includes, объект — собственное свойство", () => {
        expect(evaluate("x in list", { x: "b", list: ["a", "b"] })).toBe(true);
        expect(evaluate("x in list", { x: "c", list: ["a", "b"] })).toBe(false);
        expect(evaluate("x in map", { x: "b", map: { b: 1 } })).toBe(true);
        expect(evaluate("x in map", { x: "toString", map: { b: 1 } })).toBe(false);
        expect(evaluate("x in map", { x: 1, map: { 1: 1 } })).toBe(false); // ключ объекта — только строка
        expect(evaluate("x in list", { x: "a", list: "abc" })).toBe(false);
        expect(evaluate("x in list", { x: "a" })).toBe(false);
        expect(evaluate("x not in list", { x: "c", list: ["a"] })).toBe(true);
        expect(evaluate("x not in list", { x: "a", list: ["a"] })).toBe(false);
    });

    it("&& и ||", () => {
        expect(evaluate("a && b", { a: true, b: true })).toBe(true);
        expect(evaluate("a && b", { a: true })).toBe(false);
        expect(evaluate("a || b", { b: true })).toBe(true);
        expect(evaluate("a || b")).toBe(false);
    });

    it("точечные и дефисные ключи читаются целиком", () => {
        expect(evaluate("supermaven.isProUser", { "supermaven.isProUser": true })).toBe(true);
        expect(evaluate("foo-bar && 2fa", { "foo-bar": true, "2fa": true })).toBe(true);
    });
});

describe("serializeWhen — каноническая запись", () => {
    it("снимает скобки и пробелы, упорядочивает операнды", () => {
        expect(canon("b && a")).toBe("a && b");
        expect(canon("(a)&&b")).toBe("a && b");
        expect(canon("a && (b && c)")).toBe("a && b && c");
        expect(canon("c || (b || a)")).toBe("a || b || c");
        // Вложенный узел раскрывается до сортировки, а не сортируется целиком.
        expect(canon("b && (a && c)")).toBe("a && b && c");
        expect(canon("b || (a || c)")).toBe("a || b || c");
        expect(canon("c || a && b")).toBe("a && b || c");
        expect(canon("(b || a) && c")).toBe("(a || b) && c");
    });

    it("каждый узел", () => {
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
    it("все ключи выражения без повторов, включая правую часть in", () => {
        expect(whenKeys(parseWhen("a && !b || c == x && a")!)).toEqual(["a", "b", "c"]);
        expect(whenKeys(parseWhen("x in list && y not in other")!)).toEqual(["x", "list", "y", "other"]);
        expect(whenKeys(parseWhen("true || false || !false")!)).toEqual([]);
        expect(whenKeys(parseWhen("r =~ /x/ && n > 1")!)).toEqual(["r", "n"]);
    });
});

describe("deserializeWhen — кэш по строке", () => {
    it("одна строка — один и тот же объект дерева; ошибка тоже кэшируется", () => {
        const first = deserializeWhen("cacheProbeA && cacheProbeB");
        expect(first).toEqual(parseWhen("cacheProbeA && cacheProbeB"));
        expect(deserializeWhen("cacheProbeA && cacheProbeB")).toBe(first);
        expect(deserializeWhen("cacheProbe = broken")).toBeUndefined();
        expect(deserializeWhen("cacheProbe = broken")).toBeUndefined();
    });
});
