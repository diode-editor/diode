import { describe, expect, it } from "vitest";

import { charMask, fuzzyMatchBest, fuzzyMatchPrepared, fuzzyMatchPreparedLower, prepareQuery } from "./fuzzySearch.ts";

/** Короткая запись: подготовить запрос и сразу смэтчить его с текстом. */
function match(query: string, text: string): ReturnType<typeof fuzzyMatchPrepared> {
    return fuzzyMatchPrepared(prepareQuery(query), text);
}

/** Очки совпадения; null превращается в NaN, чтобы сравнение не прошло молча. */
function score(query: string, text: string): number {
    return match(query, text)?.score ?? Number.NaN;
}

// ─── prepareQuery: разбор строки на термы ────────────────────────────────────

describe("prepareQuery — термы", () => {
    it("запрос без пробелов — один терм", () => {
        expect(prepareQuery("panel").terms).toEqual(["panel"]);
    });

    it("пробел разделяет термы", () => {
        expect(prepareQuery("toggle panel").terms).toEqual(["toggle", "panel"]);
    });

    it("термы приводятся к нижнему регистру", () => {
        expect(prepareQuery("Toggle PANEL").terms).toEqual(["toggle", "panel"]);
    });

    it("пустой запрос термов не даёт", () => {
        expect(prepareQuery("").terms).toEqual([]);
    });

    it("запрос из одних пробелов термов не даёт — список не гаснет", () => {
        expect(prepareQuery("   ").terms).toEqual([]);
    });

    it("несколько пробелов подряд — не отдельные термы", () => {
        expect(prepareQuery("go  line").terms).toEqual(["go", "line"]);
    });

    it("ведущий и хвостовой пробел термами не становятся", () => {
        expect(prepareQuery(" go line ").terms).toEqual(["go", "line"]);
    });

    it("табуляция — такой же разделитель, как пробел", () => {
        expect(prepareQuery("go\tline").terms).toEqual(["go", "line"]);
    });
});

describe("prepareQuery — маска символов", () => {
    it("маска — объединение масок термов", () => {
        expect(prepareQuery("go line").bits).toBe(charMask("goline"));
    });

    it("пробел в маску не попадает: он разделитель, а не искомый символ", () => {
        // Иначе отсев по маске выбрасывал бы все записи без пробела в пути —
        // ровно так запрос `src other` и не находил ничего.
        expect(prepareQuery("go line").bits).not.toBe(charMask("go line"));
        expect(prepareQuery("go line").bits & charMask(" ")).toBe(0);
    });

    it("у пустого запроса маска пустая", () => {
        expect(prepareQuery("  ").bits).toBe(0);
    });

    it("маска — необходимое условие совпадения: текст без символа терма не проходит", () => {
        const query = prepareQuery("src other");
        expect(charMask("src/main.ts") & query.bits).not.toBe(query.bits);
        expect(charMask("src/other.ts") & query.bits).toBe(query.bits);
    });
});

// ─── AND по термам ───────────────────────────────────────────────────────────

describe("fuzzyMatchPrepared — все термы обязаны найтись", () => {
    it("пробел не ищется в тексте буквально", () => {
        // Главный симптом: запрос из двух слов находил только текст, где пробел
        // стоит ровно между ними.
        expect(match("src other", "src/other.ts")).not.toBeNull();
        expect(fuzzyMatchBest("src other", "src/other.ts")).toBeNull();
    });

    it("термы матчатся в любом порядке относительно текста", () => {
        expect(match("other src", "src/other.ts")).not.toBeNull();
    });

    it("ненайденный терм отбрасывает запись целиком", () => {
        expect(match("src missing", "src/other.ts")).toBeNull();
    });

    it("ни один терм не найден — null", () => {
        expect(match("zzz qqq", "src/other.ts")).toBeNull();
    });

    it("текст с пробелом всё ещё находится запросом из двух термов", () => {
        expect(match("file one", "file one.txt")).not.toBeNull();
    });

    it("`go line` находит «Go to Line/Column...»", () => {
        expect(match("go line", "Go to Line/Column...")).not.toBeNull();
    });

    it("`toggle panel` находит «View: Toggle Panel Visibility»", () => {
        expect(match("toggle panel", "View: Toggle Panel Visibility")).not.toBeNull();
    });

    it("хвостовой пробел ничего не гасит", () => {
        expect(match("go line ", "Go to Line/Column...")).not.toBeNull();
    });
});

describe("fuzzyMatchPrepared — пустой запрос", () => {
    it("совпадает со всем на нулевые очки и без подсветки", () => {
        expect(match("", "anything")).toEqual({ score: 0, matchedIndices: [] });
    });

    it("запрос из одних пробелов ведёт себя как пустой", () => {
        expect(match("   ", "anything")).toEqual({ score: 0, matchedIndices: [] });
    });

    it("пустой запрос совпадает даже с пустым текстом", () => {
        expect(match("", "")).toEqual({ score: 0, matchedIndices: [] });
    });
});

// ─── Регрессия: одиночный терм — ровно прежнее поведение ─────────────────────

describe("fuzzyMatchPrepared — одиночный терм не отличим от fuzzyMatchBest", () => {
    const cases: [string, string][] = [
        ["ac", "AppContainer"],
        ["fss", "FileSearchService.ts"],
        ["src", "src/Controls/FileSearchService.ts"],
        ["zz", "AppContainer"],
        ["az", "aaaaaaaaaaaaz"],
    ];

    it("очки и индексы совпадают один в один", () => {
        for (const [query, text] of cases) {
            expect(match(query, text)).toEqual(fuzzyMatchBest(query, text));
        }
    });

    it("ранжирование «AC» → AppContainer выше abstract держится", () => {
        expect(score("ac", "AppContainer")).toBeGreaterThan(score("ac", "abstract"));
    });
});

// ─── Скоринг по термам ───────────────────────────────────────────────────────

describe("fuzzyMatchPrepared — скоринг", () => {
    it("очки суммируются по термам", () => {
        const text = "Go to Line/Column...";
        expect(score("go line", text)).toBe(score("go", text) + score("line", text));
    });

    it("бонус за границу слова остаётся: пробел в ТЕКСТЕ — по-прежнему граница", () => {
        // Разбиение запроса не отнимает бонусов: границы считаются по тексту.
        // `panel` после пробела бьёт `anel` внутри слова той же длины.
        expect(score("toggle panel", "Toggle Panel")).toBeGreaterThan(score("toggle anel", "Toggle Xanel"));
    });

    it("совпадение на границах слов бьёт совпадение в середине", () => {
        expect(score("go line", "Go Line")).toBeGreaterThan(score("go line", "ago xxline"));
    });
});

// ─── Сведение индексов ──────────────────────────────────────────────────────

describe("fuzzyMatchPrepared — индексы совпадений", () => {
    it("индексы термов сводятся в один возрастающий набор", () => {
        // "src/other.ts": `src` → 0,1,2; `other` → 4..8.
        expect(match("src other", "src/other.ts")?.matchedIndices).toEqual([0, 1, 2, 4, 5, 6, 7, 8]);
    });

    it("термы вразнобой приезжают всё равно возрастающими", () => {
        expect(match("other src", "src/other.ts")?.matchedIndices).toEqual([0, 1, 2, 4, 5, 6, 7, 8]);
    });

    it("позиция, накрытая двумя термами, попадает в набор один раз", () => {
        // `ab` → 0,1; `ba` → 1,2. Индекс 1 общий.
        expect(match("ab ba", "aba")?.matchedIndices).toEqual([0, 1, 2]);
    });

    it("полностью совпавшие термы не удваивают индексы", () => {
        expect(match("ab ab", "ab")?.matchedIndices).toEqual([0, 1]);
    });
});

// ─── *Lower-вариант: горячий путь ───────────────────────────────────────────

describe("fuzzyMatchPreparedLower — паритет с обёрткой", () => {
    const cases: [string, string][] = [
        ["src other", "src/Other.ts"],
        ["ac", "AppContainer"],
        ["go line", "Go to Line/Column..."],
        ["zz qq", "AppContainer"],
        ["", "anything"],
    ];

    it("с заранее залоуэркейшенным текстом результат тот же", () => {
        for (const [query, text] of cases) {
            const prepared = prepareQuery(query);
            expect(fuzzyMatchPreparedLower(prepared, text, text.toLowerCase())).toEqual(
                fuzzyMatchPrepared(prepared, text),
            );
        }
    });

    it("границы слов считаются по оригинальному регистру текста", () => {
        const prepared = prepareQuery("a c");
        const camel = fuzzyMatchPreparedLower(prepared, "AppContainer", "appcontainer");
        const flat = fuzzyMatchPreparedLower(prepared, "appxcontainer", "appxcontainer");
        expect(camel).not.toBeNull();
        expect(flat).not.toBeNull();
        expect(camel!.score).toBeGreaterThan(flat!.score);
    });
});
