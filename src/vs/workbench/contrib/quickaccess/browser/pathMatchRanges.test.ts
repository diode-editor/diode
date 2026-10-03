import { describe, expect, it } from "vitest";

import { splitPathMatchRanges, toMatchRanges } from "./pathMatchRanges.ts";

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

// Запрос из нескольких термов приносит индексы несколькими кусками — проверяем,
// что куски не склеиваются в один диапазон и не уезжают в чужую половину строки.
describe("splitPathMatchRanges — запрос из нескольких термов", () => {
    it("куски из разных половин остаются каждый в своей колонке", () => {
        // "src/other.ts" + запрос `src other`: 0..2 — каталог, 4..8 — имя.
        expect(splitPathMatchRanges([0, 1, 2, 4, 5, 6, 7, 8], 4)).toEqual({
            labelRanges: [[0, 5]],
            descriptionRanges: [[0, 3]],
        });
    });

    it("два куска внутри лейбла — два диапазона, а не один сплошной", () => {
        // "other.ts" + запрос `oth ts`: индексы 4,5,6 и 10,11.
        expect(splitPathMatchRanges([4, 5, 6, 10, 11], 4)).toEqual({
            labelRanges: [
                [0, 3],
                [6, 8],
            ],
            descriptionRanges: [],
        });
    });

    it("два куска внутри описания — два диапазона", () => {
        expect(splitPathMatchRanges([0, 1, 3], 4)).toEqual({
            labelRanges: [],
            descriptionRanges: [
                [0, 2],
                [3, 4],
            ],
        });
    });

    it("диапазон лейбла не продлевается хвостом описания на стыке", () => {
        // Индекс 3 — последний символ каталога, 4 — первый символ имени: после
        // пересчёта оба дают позицию 3 и 0, склеиваться им нельзя.
        expect(splitPathMatchRanges([3, 4], 4)).toEqual({
            labelRanges: [[0, 1]],
            descriptionRanges: [[3, 4]],
        });
    });
});

describe("toMatchRanges", () => {
    it("пустой набор индексов — пустой список диапазонов", () => {
        expect(toMatchRanges([])).toEqual([]);
    });

    it("одиночный индекс — диапазон из одной позиции", () => {
        expect(toMatchRanges([2])).toEqual([[2, 3]]);
    });

    it("соседние индексы склеиваются в один диапазон", () => {
        expect(toMatchRanges([0, 1, 2])).toEqual([[0, 3]]);
    });

    it("разрыв начинает новый диапазон", () => {
        expect(toMatchRanges([0, 1, 5, 6])).toEqual([
            [0, 2],
            [5, 7],
        ]);
    });

    it("диапазоны идут слева направо, в порядке индексов", () => {
        expect(toMatchRanges([1, 4, 9])).toEqual([
            [1, 2],
            [4, 5],
            [9, 10],
        ]);
    });
});
