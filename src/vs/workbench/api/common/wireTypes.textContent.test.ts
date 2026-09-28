import { describe, expect, it } from "vitest";

import { parseWireSchemes, parseWireTextContentResult } from "./wireTypes.ts";

/**
 * Разбор ответов `workspace.provideTextDocumentContent` и списков схем.
 * Граница с чужим процессом: «провайдер сказал нет» (`null`) и «канал отдал
 * мусор» (исключение) — разные исходы, и ядро показывает их человеку по-разному.
 */
describe("parseWireTextContentResult", () => {
    it("отдаёт строку содержимого", () => {
        expect(parseWireTextContentResult({ content: "class Foo {}" })).toBe("class Foo {}");
    });

    it("пустая строка — валидное содержимое, а не отказ", () => {
        expect(parseWireTextContentResult({ content: "" })).toBe("");
    });

    it("null и отсутствие поля — отказ провайдера", () => {
        expect(parseWireTextContentResult({ content: null })).toBeNull();
        expect(parseWireTextContentResult({})).toBeNull();
    });

    it("не-объект — сломанный канал, а не отказ", () => {
        expect(() => parseWireTextContentResult("class Foo {}")).toThrow(/must be an object/u);
        expect(() => parseWireTextContentResult(null)).toThrow(/must be an object/u);
    });

    it("content не строка — сломанный канал", () => {
        expect(() => parseWireTextContentResult({ content: 42 })).toThrow(/must be a string or null/u);
    });
});

describe("parseWireSchemes", () => {
    it("отдаёт объявленные схемы", () => {
        expect(parseWireSchemes({ schemes: ["jdt", "class"] })).toEqual(["jdt", "class"]);
    });

    it("нестроковые элементы отбрасывает, остальные оставляет", () => {
        expect(parseWireSchemes({ schemes: ["jdt", 1, null, "class"] })).toEqual(["jdt", "class"]);
    });

    it("нет поля, не массив, не объект — пустой список", () => {
        expect(parseWireSchemes({})).toEqual([]);
        expect(parseWireSchemes({ schemes: "jdt" })).toEqual([]);
        expect(parseWireSchemes(null)).toEqual([]);
    });
});
