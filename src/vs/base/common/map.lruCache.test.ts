import { describe, expect, it } from "vitest";

import { LRUCache } from "./map.ts";

/** Consumer: `getMapForWordSeparators` in the vendored `core/wordCharacterClassifier.ts`. */

describe("LRUCache", () => {
    it("отдаёт положенное значение, на неизвестный ключ — undefined", () => {
        const cache = new LRUCache<string, number>(2);
        cache.set("a", 1);
        expect(cache.get("a")).toBe(1);
        expect(cache.get("нет")).toBeUndefined();
    });

    it("сверх лимита вытесняет самый старый ключ", () => {
        const cache = new LRUCache<string, number>(2);
        cache.set("a", 1).set("b", 2).set("c", 3);
        expect(cache.size).toBe(2);
        expect(cache.get("a")).toBeUndefined();
        expect(cache.get("b")).toBe(2);
        expect(cache.get("c")).toBe(3);
    });

    it("get освежает ключ — вытесняется другой", () => {
        const cache = new LRUCache<string, number>(2);
        cache.set("a", 1).set("b", 2);
        cache.get("a");
        cache.set("c", 3);
        expect(cache.get("a")).toBe(1);
        expect(cache.get("b")).toBeUndefined();
    });

    it("повторный set освежает ключ и заменяет значение без роста", () => {
        const cache = new LRUCache<string, number>(2);
        cache.set("a", 1).set("b", 2).set("a", 10);
        expect(cache.size).toBe(2);
        cache.set("c", 3);
        expect(cache.get("a")).toBe(10);
        expect(cache.get("b")).toBeUndefined();
    });

    it("хранит и undefined как значение", () => {
        const cache = new LRUCache<string, number | undefined>(2);
        cache.set("a", undefined).set("b", 2);
        cache.get("a");
        cache.set("c", 3);
        expect(cache.get("b")).toBeUndefined();
        expect(cache.size).toBe(2);
    });
});
