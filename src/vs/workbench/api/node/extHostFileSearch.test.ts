import { describe, expect, it } from "vitest";

import { parseFileIndexRequest, parseFileQueryRequest } from "./extHostFileSearch.ts";

describe("extHostFileSearch — request parsers", () => {
    const valid = {
        cacheKey: "k",
        folder: "/ws",
        excludes: ["**/out"],
        useIgnoreFiles: { local: false, parent: true, global: true },
    };

    it("takes a well-formed index request as is", () => {
        expect(parseFileIndexRequest(valid)).toEqual(valid);
    });

    it("missing ignore-file flags take upstream defaults", () => {
        expect(parseFileIndexRequest({ ...valid, useIgnoreFiles: undefined }).useIgnoreFiles).toEqual({
            local: true,
            parent: false,
            global: false,
        });
    });

    it.each([
        ["cacheKey", { ...valid, cacheKey: 1 }],
        ["folder", { ...valid, folder: null }],
        ["excludes", { ...valid, excludes: "**/out" }],
        ["excludes", { ...valid, excludes: [1] }],
    ])("rejects an index request with a bad %s", (field, params) => {
        expect(() => parseFileIndexRequest(params)).toThrow(field);
    });

    it("rejects an absent index request", () => {
        expect(() => parseFileIndexRequest(undefined)).toThrow("cacheKey");
    });

    it("takes a well-formed query request as is", () => {
        expect(parseFileQueryRequest({ cacheKey: "k", query: "q", maxResults: 5 })).toEqual({
            cacheKey: "k",
            query: "q",
            maxResults: 5,
        });
    });

    it.each([
        ["cacheKey", { query: "q", maxResults: 5 }],
        ["query", { cacheKey: "k", maxResults: 5 }],
        ["maxResults", { cacheKey: "k", query: "q", maxResults: "5" }],
    ])("rejects a query request with a bad %s", (field, params) => {
        expect(() => parseFileQueryRequest(params)).toThrow(field);
    });

    it("rejects an absent query request", () => {
        expect(() => parseFileQueryRequest(null)).toThrow("cacheKey");
    });
});
