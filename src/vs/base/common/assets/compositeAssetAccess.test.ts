import { describe, expect, it } from "vitest";

import { CompositeAssetAccess } from "./compositeAssetAccess.ts";
import type { IAssetAccess, IAssetEntry } from "./iAssetAccess.ts";

class FakeAccess implements IAssetAccess {
    private readonly files: Record<string, string | undefined>;
    private readonly entries: Record<string, IAssetEntry[]>;

    public constructor(files: Record<string, string | undefined>, entries: Record<string, IAssetEntry[]> = {}) {
        this.files = files;
        this.entries = entries;
    }

    public read(p: string): Promise<Uint8Array> {
        const t = this.files[p];
        if (t === undefined) throw new Error(`missing: ${p}`);
        return Promise.resolve(new TextEncoder().encode(t));
    }
    public readText(p: string): Promise<string> {
        const t = this.files[p];
        if (t === undefined) throw new Error(`missing: ${p}`);
        return Promise.resolve(t);
    }
    public exists(p: string): Promise<boolean> {
        return Promise.resolve(this.files[p] !== undefined);
    }
    public listEntries(prefix: string): Promise<IAssetEntry[]> {
        return Promise.resolve(this.entries[prefix] ?? []);
    }
}

describe("CompositeAssetAccess", () => {
    it("routes to matching prefix", async () => {
        const a = new FakeAccess({ "Extensions/builtin/js/package.json": "builtin" });
        const b = new FakeAccess({ "UserExtensions/foo/package.json": "user" });
        const c = new CompositeAssetAccess({
            "Extensions/builtin/": a,
            "UserExtensions/": b,
        });
        expect(await c.readText("Extensions/builtin/js/package.json")).toBe("builtin");
        expect(await c.readText("UserExtensions/foo/package.json")).toBe("user");
    });

    it("picks the longest matching prefix", async () => {
        const generic = new FakeAccess({ "a/b/c.txt": "generic" });
        const specific = new FakeAccess({ "a/b/c.txt": "specific" });
        const c = new CompositeAssetAccess({ "a/": generic, "a/b/": specific });
        expect(await c.readText("a/b/c.txt")).toBe("specific");
    });

    it("listEntries returns empty for unknown prefix", async () => {
        const a = new FakeAccess({}, { "x/": [{ name: "foo", isDirectory: true }] });
        const c = new CompositeAssetAccess({ "x/": a });
        expect(await c.listEntries("x/")).toEqual([{ name: "foo", isDirectory: true }]);
        expect(await c.listEntries("nope/")).toEqual([]);
    });

    it("exists delegates to the matched backend", async () => {
        const a = new FakeAccess({ "x/file.txt": "data" });
        const c = new CompositeAssetAccess({ "x/": a });
        expect(await c.exists("x/file.txt")).toBe(true);
        expect(await c.exists("x/missing.txt")).toBe(false);
    });

    it("exists returns false instead of throwing for unrouted path", async () => {
        const a = new FakeAccess({});
        const c = new CompositeAssetAccess({ "x/": a });
        expect(await c.exists("y/something")).toBe(false);
    });

    it("read throws for unrouted path", async () => {
        const a = new FakeAccess({});
        const c = new CompositeAssetAccess({ "x/": a });
        await expect(c.read("y/file")).rejects.toThrow(/No CompositeAssetAccess route/);
    });

    it("rejects non-empty prefix without trailing slash", () => {
        expect(() => new CompositeAssetAccess({ bad: new FakeAccess({}) })).toThrow(/must end with "\/"/);
    });
});
