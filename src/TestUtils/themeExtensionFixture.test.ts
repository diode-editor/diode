import { describe, expect, it } from "vitest";

import { extensionWithThemes, MemoryAssets } from "./themeExtensionFixture.ts";

describe("themeExtensionFixture", () => {
    it("MemoryAssets returns text and bytes, knows existence, does not list directories", async () => {
        const assets = new MemoryAssets({ "a/b.json": "{}" });
        expect(await assets.readText("a/b.json")).toBe("{}");
        expect(await assets.read("a/b.json")).toEqual(new TextEncoder().encode("{}"));
        expect(await assets.exists("a/b.json")).toBe(true);
        expect(await assets.exists("a/c.json")).toBe(false);
        expect(await assets.listEntries()).toEqual([]);
        await expect(assets.readText("a/c.json")).rejects.toThrow("ENOENT");
        expect(assets.reads).toEqual(["a/b.json", "a/b.json", "a/c.json"]);
    });

    it("extensionWithThemes splits id into publisher/name and picks the prefix by isBuiltin", () => {
        const user = extensionWithThemes("acme.theme", []);
        expect(user.manifest.publisher).toBe("acme");
        expect(user.manifest.name).toBe("theme");
        expect(user.location).toBe("UserExtensions/acme.theme-1.0.0/");
        expect(extensionWithThemes("vscode.theme-defaults", [], true).location).toBe(
            "Extensions/builtin/vscode.theme-defaults-1.0.0/",
        );
        // An id without a dot is malformed, but the fixture does not throw.
        const bare = extensionWithThemes("bare", []);
        expect(bare.manifest.publisher).toBe("bare");
        expect(bare.manifest.name).toBe("bare");
    });
});
