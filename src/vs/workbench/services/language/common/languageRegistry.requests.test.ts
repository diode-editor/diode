import { describe, expect, it } from "vitest";

import { LanguageRegistry } from "./languageRegistry.ts";

describe("LanguageRegistry — запрос фич языка", () => {
    it("сигнал — один на язык: повторный запрос того же языка молчит", () => {
        const registry = new LanguageRegistry();
        const requested: string[] = [];
        registry.onDidRequestLanguageFeatures((id) => requested.push(id));

        registry.requestLanguageFeatures("typescript");
        registry.requestLanguageFeatures("json");
        registry.requestLanguageFeatures("typescript");

        expect(requested).toEqual(["typescript", "json"]);
    });

    it("снятый слушатель запросов не слышит, остальные слышат", () => {
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
