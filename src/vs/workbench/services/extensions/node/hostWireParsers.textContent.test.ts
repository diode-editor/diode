import { describe, expect, it } from "vitest";

import { parseWireSchemes, parseWireTextContentResult } from "./hostWireParsers.ts";

describe("parseWireTextContentResult", () => {
    it("returns the content string", () => {
        expect(parseWireTextContentResult({ content: "class Foo {}" })).toBe("class Foo {}");
    });

    it("an empty string is valid content, not a refusal", () => {
        expect(parseWireTextContentResult({ content: "" })).toBe("");
    });

    it("null and a missing field mean the provider refused", () => {
        expect(parseWireTextContentResult({ content: null })).toBeNull();
        expect(parseWireTextContentResult({})).toBeNull();
    });

    it("a non-object means a broken channel, not a refusal", () => {
        expect(() => parseWireTextContentResult("class Foo {}")).toThrow(/must be an object/u);
        expect(() => parseWireTextContentResult(null)).toThrow(/must be an object/u);
    });

    it("a non-string content means a broken channel", () => {
        expect(() => parseWireTextContentResult({ content: 42 })).toThrow(/must be a string or null/u);
    });
});

describe("parseWireSchemes", () => {
    it("returns the declared schemes", () => {
        expect(parseWireSchemes({ schemes: ["jdt", "class"] })).toEqual(["jdt", "class"]);
    });

    it("drops non-string elements and keeps the rest", () => {
        expect(parseWireSchemes({ schemes: ["jdt", 1, null, "class"] })).toEqual(["jdt", "class"]);
    });

    it("no field, not an array, not an object gives an empty list", () => {
        expect(parseWireSchemes({})).toEqual([]);
        expect(parseWireSchemes({ schemes: "jdt" })).toEqual([]);
        expect(parseWireSchemes(null)).toEqual([]);
    });
});
