import { describe, expect, it } from "vitest";

import { SetMap } from "./map.ts";

/** Consumer: the vendored `computeMovedLines`. */

describe("SetMap", () => {
    it("accumulates several values under one key", () => {
        const map = new SetMap<string, number>();
        map.add("a", 1);
        map.add("a", 2);
        expect([...map.get("a")]).toEqual([1, 2]);
    });

    it("returns an empty set for an unknown key, not undefined", () => {
        expect(new SetMap<string, number>().get("missing").size).toBe(0);
    });

    it("delete removes the value, keeping the others", () => {
        const map = new SetMap<string, number>();
        map.add("a", 1);
        map.add("a", 2);
        map.delete("a", 1);
        expect([...map.get("a")]).toEqual([2]);
    });

    it("removing the last value drops the key itself", () => {
        const map = new SetMap<string, number>();
        map.add("a", 1);
        map.delete("a", 1);
        expect(map.get("a").size).toBe(0);
    });

    it("delete on an unknown key is a no-op", () => {
        expect(() => {
            new SetMap<string, number>().delete("missing", 1);
        }).not.toThrow();
    });

    it("forEach iterates the values of a key", () => {
        const map = new SetMap<string, number>();
        map.add("a", 1);
        map.add("a", 2);
        const seen: number[] = [];
        map.forEach("a", (v) => seen.push(v));
        expect(seen).toEqual([1, 2]);
    });

    it("forEach on an unknown key calls nothing", () => {
        const seen: number[] = [];
        new SetMap<string, number>().forEach("missing", (v) => seen.push(v));
        expect(seen).toEqual([]);
    });

    it("keys are independent", () => {
        const map = new SetMap<string, number>();
        map.add("a", 1);
        map.add("b", 2);
        expect([...map.get("a")]).toEqual([1]);
        expect([...map.get("b")]).toEqual([2]);
    });
});
