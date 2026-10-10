import { describe, expect, it } from "vitest";

import { createMatchers, type Matcher } from "./textMateScopeMatcher.ts";

/**
 * Вход матчера — набор имён; имя-идентификатор совпадает, если есть во входе,
 * а вес — номер (1-based) последнего найденного идентификатора пути.
 */
function matchesName(names: readonly string[], input: readonly string[]): number {
    let score = -1;
    for (const name of names) {
        const index = input.indexOf(name);
        if (index === -1) return -1;
        score = index + 1;
    }
    return score;
}

function compile(selector: string): Matcher<readonly string[]>[] {
    const results: Matcher<readonly string[]>[] = [];
    createMatchers(selector, matchesName, results);
    return results;
}

function scores(selector: string, input: readonly string[]): number[] {
    return compile(selector).map((matcher) => matcher(input));
}

describe("createMatchers", () => {
    it("одиночный скоуп и путь скоупов через пробел", () => {
        expect(scores("a", ["x", "a"])).toEqual([2]);
        expect(scores("a b", ["a", "b"])).toEqual([2]);
        expect(scores("a b", ["b"])).toEqual([-1]);
    });

    it("запятая верхнего уровня — отдельные матчеры альтернатив", () => {
        expect(scores("a, b", ["b"])).toEqual([-1, 1]);
    });

    it("отрицание: совпадение даёт -1, несовпадение — 0", () => {
        expect(scores("-a", ["a"])).toEqual([-1]);
        expect(scores("-a", ["b"])).toEqual([0]);
        expect(scores("b -a", ["b"])).toEqual([0]);
        expect(scores("b -a", ["b", "a"])).toEqual([-1]);
    });

    it("конъюнкция — минимум, и первый промах обрывает её", () => {
        expect(scores("a b c", ["c", "b", "a"])).toEqual([1]);
        expect(scores("a z b", ["a", "b"])).toEqual([-1]);
    });

    it("скобки: дизъюнкция через `|` и `,` — максимум, подряд идущие разделители схлопываются", () => {
        expect(scores("(a | b)", ["b"])).toEqual([1]);
        expect(scores("(a , , b)", ["x", "a"])).toEqual([2]);
        expect(scores("(a | b)", ["c"])).toEqual([-1]);
        expect(scores("(a | b) c", ["a", "c"])).toEqual([1]);
        expect(scores("(a | b", ["b"])).toEqual([1]);
        expect(scores("(a) b", ["a", "b"])).toEqual([1]);
    });

    it("приоритеты L:/R: пропускаются", () => {
        expect(scores("L:a, R:b", ["a", "b"])).toEqual([1, 2]);
    });

    it("пустые и битые селекторы не дают матчеров", () => {
        expect(compile("")).toEqual([]);
        expect(compile("-")).toEqual([]);
        expect(compile("()")).toEqual([]);
        expect(compile("|")).toEqual([]);
    });

    it("после невалидной альтернативы разбор останавливается без запятой", () => {
        expect(scores("a ) b", ["a", "b"])).toEqual([1]);
    });

    it("приоритет — только двухсимвольный токен с двоеточием; прочие — идентификаторы", () => {
        expect(scores("ab", ["ab"])).toEqual([1]);
        expect(scores("abc:", ["abc:"])).toEqual([1]);
    });

    it("двойное отрицание: несовпадение внутреннего даёт -1", () => {
        expect(scores("- -a", ["x"])).toEqual([-1]);
        expect(scores("- -a", ["a"])).toEqual([0]);
    });

    it("после скобки конъюнкция продолжается: недостающий операнд — промах", () => {
        expect(scores("(a) b", ["a"])).toEqual([-1]);
    });

    it("нулевой вес отрицания не обрывает конъюнкцию: следующий промах её валит", () => {
        expect(scores("-a (b)", ["x"])).toEqual([-1]);
    });

    it("в скобках обе альтернативы — и через `,`, и через повторённый `|`", () => {
        expect(scores("(a , b)", ["b"])).toEqual([1]);
        expect(scores("(a | | b)", ["b"])).toEqual([1]);
    });

    it("идентификатор допускает точки, двоеточия и дефисы внутри", () => {
        expect(scores("meta.tag-name:x", ["meta.tag-name:x"])).toEqual([1]);
    });
});
