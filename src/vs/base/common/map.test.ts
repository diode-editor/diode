import { describe, expect, it } from "vitest";

import { SetMap } from "./map.ts";

/** Потребитель — перенесённый `computeMovedLines`. */

describe("SetMap", () => {
    it("копит несколько значений под одним ключом", () => {
        const map = new SetMap<string, number>();
        map.add("a", 1);
        map.add("a", 2);
        expect([...map.get("a")]).toEqual([1, 2]);
    });

    it("на неизвестный ключ отдаёт пустое множество, а не undefined", () => {
        expect(new SetMap<string, number>().get("нет").size).toBe(0);
    });

    it("delete убирает значение, оставляя остальные", () => {
        const map = new SetMap<string, number>();
        map.add("a", 1);
        map.add("a", 2);
        map.delete("a", 1);
        expect([...map.get("a")]).toEqual([2]);
    });

    it("удаление последнего значения выбрасывает и сам ключ", () => {
        const map = new SetMap<string, number>();
        map.add("a", 1);
        map.delete("a", 1);
        expect(map.get("a").size).toBe(0);
    });

    it("delete по неизвестному ключу — no-op", () => {
        expect(() => {
            new SetMap<string, number>().delete("нет", 1);
        }).not.toThrow();
    });

    it("forEach обходит значения ключа", () => {
        const map = new SetMap<string, number>();
        map.add("a", 1);
        map.add("a", 2);
        const seen: number[] = [];
        map.forEach("a", (v) => seen.push(v));
        expect(seen).toEqual([1, 2]);
    });

    it("forEach по неизвестному ключу ничего не зовёт", () => {
        const seen: number[] = [];
        new SetMap<string, number>().forEach("нет", (v) => seen.push(v));
        expect(seen).toEqual([]);
    });

    it("ключи независимы", () => {
        const map = new SetMap<string, number>();
        map.add("a", 1);
        map.add("b", 2);
        expect([...map.get("a")]).toEqual([1]);
        expect([...map.get("b")]).toEqual([2]);
    });
});
