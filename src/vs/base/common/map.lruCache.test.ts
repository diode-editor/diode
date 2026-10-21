import { describe, expect, it } from "vitest";

import { LRUCache } from "./map.ts";

/** Consumer: `getMapForWordSeparators` in the vendored `core/wordCharacterClassifier.ts`. */

describe("LRUCache", () => {
    it("returns the stored value, undefined for an unknown key", () => {
        const cache = new LRUCache<string, number>(2);
        cache.set("a", 1);
        expect(cache.get("a")).toBe(1);
        expect(cache.get("missing")).toBeUndefined();
    });

    it("evicts the oldest key over the limit", () => {
        const cache = new LRUCache<string, number>(2);
        cache.set("a", 1).set("b", 2).set("c", 3);
        expect(cache.size).toBe(2);
        expect(cache.get("a")).toBeUndefined();
        expect(cache.get("b")).toBe(2);
        expect(cache.get("c")).toBe(3);
    });

    it("get refreshes the key — another one is evicted", () => {
        const cache = new LRUCache<string, number>(2);
        cache.set("a", 1).set("b", 2);
        cache.get("a");
        cache.set("c", 3);
        expect(cache.get("a")).toBe(1);
        expect(cache.get("b")).toBeUndefined();
    });

    it("a repeated set refreshes the key and replaces the value without growing", () => {
        const cache = new LRUCache<string, number>(2);
        cache.set("a", 1).set("b", 2).set("a", 10);
        expect(cache.size).toBe(2);
        cache.set("c", 3);
        expect(cache.get("a")).toBe(10);
        expect(cache.get("b")).toBeUndefined();
    });

    it("stores undefined as a value too", () => {
        const cache = new LRUCache<string, number | undefined>(2);
        cache.set("a", undefined).set("b", 2);
        cache.get("a");
        cache.set("c", 3);
        expect(cache.get("b")).toBeUndefined();
        expect(cache.size).toBe(2);
    });
});
