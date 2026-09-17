import { describe, expect, it } from "vitest";

import { splitPathMatchRanges } from "./pathMatchRanges.ts";

// "src/app.ts": basename "app.ts" начинается с индекса 4.
const BASENAME_OFFSET = 4;

describe("splitPathMatchRanges", () => {
    it("совпадение целиком в имени файла уезжает в лейбл с локальным оффсетом", () => {
        expect(splitPathMatchRanges([4, 5, 6], BASENAME_OFFSET)).toEqual({
            labelRanges: [[0, 3]],
            descriptionRanges: [],
        });
    });

    it("совпадение целиком в каталоге уезжает в описание как есть", () => {
        expect(splitPathMatchRanges([0, 1, 2], BASENAME_OFFSET)).toEqual({
            labelRanges: [],
            descriptionRanges: [[0, 3]],
        });
    });

    it("совпадение на границе разносится по обеим колонкам", () => {
        expect(splitPathMatchRanges([2, 3, 4], BASENAME_OFFSET)).toEqual({
            labelRanges: [[0, 1]],
            descriptionRanges: [[2, 4]],
        });
    });

    it("разрывы дают отдельные диапазоны, а соседние индексы склеиваются", () => {
        expect(splitPathMatchRanges([4, 5, 8], BASENAME_OFFSET)).toEqual({
            labelRanges: [
                [0, 2],
                [4, 5],
            ],
            descriptionRanges: [],
        });
    });

    it("нет совпадений — нет диапазонов", () => {
        expect(splitPathMatchRanges([], BASENAME_OFFSET)).toEqual({ labelRanges: [], descriptionRanges: [] });
    });

    it("описания нет (оффсет 0) — всё уходит в лейбл", () => {
        expect(splitPathMatchRanges([0, 1], 0)).toEqual({ labelRanges: [[0, 2]], descriptionRanges: [] });
    });
});
