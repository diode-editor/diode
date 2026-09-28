import { describe, expect, it } from "vitest";

import { parseGotoLineQuery, splitFileQuery } from "./lineColumnQuery.ts";

describe("splitFileQuery", () => {
    it("returns the whole query when there is no suffix", () => {
        expect(splitFileQuery("src/App.ts")).toEqual({ filePart: "src/App.ts", goto: null });
    });

    it("strips a trailing colon even without a number (mid-typing)", () => {
        expect(splitFileQuery("App.ts:")).toEqual({ filePart: "App.ts", goto: null });
    });

    it("parses a line suffix", () => {
        expect(splitFileQuery("App.ts:42")).toEqual({ filePart: "App.ts", goto: { line: 42 } });
    });

    it("parses a line:column suffix", () => {
        expect(splitFileQuery("App.ts:42:7")).toEqual({ filePart: "App.ts", goto: { line: 42, column: 7 } });
    });

    it("accepts a comma as the line/column separator", () => {
        expect(splitFileQuery("App.ts:42,7")).toEqual({ filePart: "App.ts", goto: { line: 42, column: 7 } });
    });

    it("leaves a colon that is not a trailing number in the file part", () => {
        expect(splitFileQuery("foo:bar")).toEqual({ filePart: "foo:bar", goto: null });
    });

    it("does not treat a mid-string colon+number as a suffix", () => {
        expect(splitFileQuery("foo:12bar")).toEqual({ filePart: "foo:12bar", goto: null });
    });
});

describe("parseGotoLineQuery", () => {
    it("returns null for a bare colon", () => {
        expect(parseGotoLineQuery(":")).toBeNull();
    });

    it("parses a line-only goto", () => {
        expect(parseGotoLineQuery(":128")).toEqual({ line: 128 });
    });

    it("parses line and column with a colon", () => {
        expect(parseGotoLineQuery(":128:4")).toEqual({ line: 128, column: 4 });
    });

    it("parses line and column with a comma", () => {
        expect(parseGotoLineQuery(":128,4")).toEqual({ line: 128, column: 4 });
    });
});
