import { describe, expect, it } from "vitest";

import { ConfigurationModel } from "./configurationModel.ts";

describe("ConfigurationModel", () => {
    describe("fromRaw", () => {
        it("returns empty for non-object input", () => {
            expect(ConfigurationModel.fromRaw(null).get("x")).toBeUndefined();
            expect(ConfigurationModel.fromRaw(undefined).get("x")).toBeUndefined();
            expect(ConfigurationModel.fromRaw([1, 2]).get("0")).toBeUndefined();
            expect(ConfigurationModel.fromRaw(42).get("x")).toBeUndefined();
        });

        it("reads top-level keys", () => {
            const m = ConfigurationModel.fromRaw({ a: 1, b: "x" });
            expect(m.get<number>("a")).toBe(1);
            expect(m.get<string>("b")).toBe("x");
        });

        it("expands dotted keys to nested objects", () => {
            const m = ConfigurationModel.fromRaw({ "editor.tabSize": 4 });
            expect(m.get<number>("editor.tabSize")).toBe(4);
            expect(m.getValue("editor")).toEqual({ tabSize: 4 });
        });

        it("merges dotted and nested forms", () => {
            const m = ConfigurationModel.fromRaw({
                editor: { insertSpaces: false },
                "editor.tabSize": 2,
            });
            expect(m.get<number>("editor.tabSize")).toBe(2);
            expect(m.get<boolean>("editor.insertSpaces")).toBe(false);
        });

        it("не разворачивает точки внутри значения — ключ map'а это данные", () => {
            // Регрессия: рекурсивная нормализация ломала map-настройки, у которых
            // ключ сам по себе данные (глоб `files.watcherExclude`, `*.ext`
            // `files.associations`).
            const m = ConfigurationModel.fromRaw({
                "files.watcherExclude": { ".git/objects/**": true, "**/node_modules/**": true },
                "files.associations": { "*.myphp": "php" },
            });
            expect(m.get("files.watcherExclude")).toEqual({
                ".git/objects/**": true,
                "**/node_modules/**": true,
            });
            expect(m.get("files.associations")).toEqual({ "*.myphp": "php" });
        });

        it("does not flatten array values", () => {
            const m = ConfigurationModel.fromRaw({ "files.exclude": ["a", "b"] });
            expect(m.get("files.exclude")).toEqual(["a", "b"]);
        });

        it("deep-merges a dotted key into a colliding nested object", () => {
            // "a.b" expands onto the already-present `a.b` object instead of
            // replacing it: both sides are plain objects, so they merge.
            const m = ConfigurationModel.fromRaw({
                a: { b: { x: 1 } },
                "a.b": { y: 2 },
            });
            expect(m.get<number>("a.b.x")).toBe(1);
            expect(m.get<number>("a.b.y")).toBe(2);
            expect(m.getValue("a.b")).toEqual({ x: 1, y: 2 });
        });
    });

    describe("get / getValue", () => {
        it("returns undefined for missing keys", () => {
            const m = ConfigurationModel.fromRaw({ a: { b: 1 } });
            expect(m.get("a.c")).toBeUndefined();
            expect(m.get("x")).toBeUndefined();
        });

        it("returns undefined for an empty key", () => {
            // splitKey("") → [] → get returns undefined (no segments to traverse).
            const m = ConfigurationModel.fromRaw({ a: 1 });
            expect(m.get("")).toBeUndefined();
        });

        it("returns undefined when a path segment descends into a primitive", () => {
            // "a" is a number, so descending to "a.b" hits a non-object midway.
            const m = ConfigurationModel.fromRaw({ a: 1 });
            expect(m.get("a.b")).toBeUndefined();
        });

        it("getValue without argument returns root object", () => {
            const m = ConfigurationModel.fromRaw({ a: 1 });
            expect(m.getValue()).toEqual({ a: 1 });
        });

        it("getValue with section returns subtree", () => {
            const m = ConfigurationModel.fromRaw({ editor: { tabSize: 4, insertSpaces: true } });
            expect(m.getValue("editor")).toEqual({ tabSize: 4, insertSpaces: true });
        });
    });

    describe("merge", () => {
        it("later layer wins for primitives", () => {
            const a = ConfigurationModel.fromRaw({ "editor.tabSize": 4 });
            const b = ConfigurationModel.fromRaw({ "editor.tabSize": 2 });
            const merged = ConfigurationModel.merge(a, b);
            expect(merged.get("editor.tabSize")).toBe(2);
        });

        it("deep-merges objects across layers", () => {
            const a = ConfigurationModel.fromRaw({ editor: { tabSize: 4 } });
            const b = ConfigurationModel.fromRaw({ editor: { insertSpaces: false } });
            const merged = ConfigurationModel.merge(a, b);
            expect(merged.getValue("editor")).toEqual({ tabSize: 4, insertSpaces: false });
        });

        it("arrays are replaced, not concatenated", () => {
            const a = ConfigurationModel.fromRaw({ "x.list": [1, 2] });
            const b = ConfigurationModel.fromRaw({ "x.list": [3] });
            expect(ConfigurationModel.merge(a, b).get("x.list")).toEqual([3]);
        });

        it("returns EMPTY for zero layers", () => {
            expect(ConfigurationModel.merge().get("x")).toBeUndefined();
        });

        it("returns the sole layer unchanged for a single-layer merge", () => {
            const only = ConfigurationModel.fromRaw({ "editor.tabSize": 4 });
            const merged = ConfigurationModel.merge(only);
            // The single-layer fast path returns the same instance.
            expect(merged).toBe(only);
            expect(merged.get("editor.tabSize")).toBe(4);
        });
    });

    describe("collectKeys", () => {
        it("flattens nested tree into dotted keys", () => {
            const m = ConfigurationModel.fromRaw({
                editor: { tabSize: 4, insertSpaces: true },
                workbench: { colorTheme: "Dark+" },
            });
            const keys = m.collectKeys().sort();
            expect(keys).toEqual(["editor.insertSpaces", "editor.tabSize", "workbench.colorTheme"]);
        });

        it("treats arrays as leaves", () => {
            const m = ConfigurationModel.fromRaw({ "files.exclude": ["a"] });
            expect(m.collectKeys()).toEqual(["files.exclude"]);
        });

        it("treats primitive leaves at any depth as keys", () => {
            const m = ConfigurationModel.fromRaw({ top: 1, nested: { value: false } });
            expect(m.collectKeys().sort()).toEqual(["nested.value", "top"]);
        });

        it("emits no key for an empty nested object", () => {
            const m = ConfigurationModel.fromRaw({ editor: {}, "files.exclude": ["a"] });
            expect(m.collectKeys()).toEqual(["files.exclude"]);
        });
    });
});
