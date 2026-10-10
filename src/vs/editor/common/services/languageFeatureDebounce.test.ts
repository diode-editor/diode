import { describe, expect, it } from "vitest";

import { FeatureDebounce } from "./languageFeatureDebounce.ts";

describe("FeatureDebounce", () => {
    it("без истории — полтора минимума", () => {
        expect(new FeatureDebounce(300, 2000).get("a")).toBe(450);
    });

    it("полтора минимума зажимается в max", () => {
        expect(new FeatureDebounce(100, 120).get("a")).toBe(120);
    });

    it("среднее ответов документа, зажатое в [min, max]", () => {
        const debounce = new FeatureDebounce(300, 2000);
        expect(debounce.update("a", 1000)).toBe(1000);
        expect(debounce.update("a", 500)).toBe(750);
        expect(debounce.get("a")).toBe(750);
        expect(debounce.update("a", 10)).toBe(503.3333333333333);
        expect(new FeatureDebounce(300, 2000).update("b", 10)).toBe(300);
        expect(new FeatureDebounce(300, 2000).update("b", 9000)).toBe(2000);
    });

    it("окно — шесть последних ответов", () => {
        const debounce = new FeatureDebounce(0, 100_000);
        for (const value of [600, 600, 600, 600, 600, 600]) debounce.update("a", value);
        expect(debounce.get("a")).toBe(600);
        // Седьмой вытесняет первый: (5·600 + 1200) / 6.
        expect(debounce.update("a", 1200)).toBe(700);
        for (let i = 0; i < 5; i++) debounce.update("a", 1200);
        expect(debounce.get("a")).toBe(1200);
    });

    it("новый документ — общее среднее по известным", () => {
        const debounce = new FeatureDebounce(300, 2000);
        debounce.update("a", 1000);
        debounce.update("b", 600);
        expect(debounce.get("c")).toBe(800);
    });

    it("общее среднее тоже зажато, нулевое — полтора минимума", () => {
        const debounce = new FeatureDebounce(300, 2000);
        debounce.update("a", 0);
        expect(debounce.get("c")).toBe(450);
        const high = new FeatureDebounce(300, 2000);
        high.update("a", 5000);
        expect(high.get("c")).toBe(2000);
    });

    it("кэш держит не больше 50 документов: старейший забывается", () => {
        const debounce = new FeatureDebounce(0, 100_000);
        debounce.update("first", 9000);
        for (let i = 0; i < 50; i++) debounce.update(`doc${String(i)}`, 100);
        // «first» вытеснен: его ответ больше не в общем среднем и не в своём ключе.
        expect(debounce.get("new")).toBe(100);
        expect(debounce.get("first")).toBe(100);
        expect(debounce.get("doc0")).toBe(100);
    });
});
