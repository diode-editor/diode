import { describe, expect, it } from "vitest";

import { FeatureDebounce } from "./languageFeatureDebounce.ts";

describe("FeatureDebounce", () => {
    it("without history: one and a half times min", () => {
        expect(new FeatureDebounce(300, 2000).get("a")).toBe(450);
    });

    it("one and a half times min is clamped to max", () => {
        expect(new FeatureDebounce(100, 120).get("a")).toBe(120);
    });

    it("mean of document responses, clamped to [min, max]", () => {
        const debounce = new FeatureDebounce(300, 2000);
        expect(debounce.update("a", 1000)).toBe(1000);
        expect(debounce.update("a", 500)).toBe(750);
        expect(debounce.get("a")).toBe(750);
        expect(debounce.update("a", 10)).toBe(503.3333333333333);
        expect(new FeatureDebounce(300, 2000).update("b", 10)).toBe(300);
        expect(new FeatureDebounce(300, 2000).update("b", 9000)).toBe(2000);
    });

    it("window is the last six responses", () => {
        const debounce = new FeatureDebounce(0, 100_000);
        for (const value of [600, 600, 600, 600, 600, 600]) debounce.update("a", value);
        expect(debounce.get("a")).toBe(600);
        // The seventh evicts the first: (5·600 + 1200) / 6.
        expect(debounce.update("a", 1200)).toBe(700);
        for (let i = 0; i < 5; i++) debounce.update("a", 1200);
        expect(debounce.get("a")).toBe(1200);
    });

    it("new document gets the overall mean of known ones", () => {
        const debounce = new FeatureDebounce(300, 2000);
        debounce.update("a", 1000);
        debounce.update("b", 600);
        expect(debounce.get("c")).toBe(800);
    });

    it("overall mean is clamped too, zero gives one and a half times min", () => {
        const debounce = new FeatureDebounce(300, 2000);
        debounce.update("a", 0);
        expect(debounce.get("c")).toBe(450);
        const high = new FeatureDebounce(300, 2000);
        high.update("a", 5000);
        expect(high.get("c")).toBe(2000);
    });

    it("cache holds at most 50 documents: the oldest is forgotten", () => {
        const debounce = new FeatureDebounce(0, 100_000);
        debounce.update("first", 9000);
        for (let i = 0; i < 50; i++) debounce.update(`doc${String(i)}`, 100);
        expect(debounce.get("new")).toBe(100);
        expect(debounce.get("first")).toBe(100);
        expect(debounce.get("doc0")).toBe(100);
    });
});
