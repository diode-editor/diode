import { describe, expect, it } from "vitest";

import { collectWordCompletions } from "./collectWordCompletions.ts";

describe("collectWordCompletions", () => {
    it("собирает уникальные слова, сохраняя порядок первого появления", () => {
        expect(collectWordCompletions(["foo bar foo baz"], "")).toEqual(["foo", "bar", "baz"]);
    });

    it("исключает набираемый префикс и короткие (<2) слова", () => {
        expect(collectWordCompletions(["ind indent a bb ind"], "ind")).toEqual(["indent", "bb"]);
    });

    it("объединяет несколько текстов с дедупом", () => {
        expect(collectWordCompletions(["alpha beta", "beta gamma"], "")).toEqual(["alpha", "beta", "gamma"]);
    });

    it("игнорирует не-идентификаторные символы и цифры в начале", () => {
        expect(collectWordCompletions(["a1 = 12; _x.y-z"], "")).toEqual(["a1", "_x"]);
    });

    it("собирает слова любого алфавита, а не только ASCII", () => {
        expect(collectWordCompletions(["фыва привет_2 naïve 1тест"], "")).toEqual([
            "фыва",
            "привет_2",
            "naïve",
            "тест",
        ]);
    });

    it("пропускает документы крупнее лимита (защита больших файлов)", () => {
        const big = "word ".repeat(500); // > лимита ниже
        expect(collectWordCompletions([big, "small tiny"], "", { maxBytesPerText: 100 })).toEqual(["small", "tiny"]);
    });

    it("ограничивает число слов кап'ом", () => {
        const words = collectWordCompletions(["aa bb cc dd ee"], "", { maxWords: 3 });
        expect(words).toEqual(["aa", "bb", "cc"]);
    });
});
