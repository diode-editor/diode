import { describe, expect, it } from "vitest";

import { LanguageRegistry } from "./languageRegistry.ts";

describe("LanguageRegistry: language feature requests", () => {
    it("one signal per language: a repeated request for the same language stays silent", () => {
        const registry = new LanguageRegistry();
        const requested: string[] = [];
        registry.onDidRequestLanguageFeatures((id) => requested.push(id));

        registry.requestLanguageFeatures("typescript");
        registry.requestLanguageFeatures("json");
        registry.requestLanguageFeatures("typescript");

        expect(requested).toEqual(["typescript", "json"]);
    });

    it("a removed listener does not hear requests, the others do", () => {
        const registry = new LanguageRegistry();
        const removed: string[] = [];
        const kept: string[] = [];
        registry.onDidRequestLanguageFeatures((id) => removed.push(id)).dispose();
        registry.onDidRequestLanguageFeatures((id) => kept.push(id));

        registry.requestLanguageFeatures("go");

        expect(removed).toEqual([]);
        expect(kept).toEqual(["go"]);
    });
});
