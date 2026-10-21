import { describe, expect, it } from "vitest";

import { ContextKeyService } from "./contextKeyService.ts";

describe("ContextKeyService — extension keys", () => {
    it("a dotted key is read as a whole", () => {
        const ctx = new ContextKeyService();
        expect(ctx.evaluate("supermaven.isProUser")).toBe(false);

        ctx.setRaw("supermaven.isProUser", true);
        expect(ctx.evaluate("supermaven.isProUser")).toBe(true);
    });

    it("several keys with one root live side by side", () => {
        const ctx = new ContextKeyService();
        ctx.setRaw("myext.armed", true);
        ctx.setRaw("myext.mode", "fast");
        expect(ctx.evaluate("myext.armed && myext.mode == 'fast'")).toBe(true);
        expect(ctx.evaluate("myext.armed && myext.mode == 'slow'")).toBe(false);
        expect(ctx.evaluate("myext.armed && myext.mode == fast")).toBe(true);
    });

    it("names that are not JS identifiers are reachable", () => {
        const ctx = new ContextKeyService();
        ctx.setRaw("foo-bar", true);
        ctx.setRaw("2fa", true);
        ctx.setRaw("class", true);
        expect(ctx.evaluate("foo-bar && 2fa && class")).toBe(true);
    });

    it("a flat key and a dotted one with the same root do not interfere", () => {
        const ctx = new ContextKeyService();
        ctx.setRaw("dup", false);
        ctx.setRaw("dup.child", true);
        expect(ctx.evaluate("dup")).toBe(false);
        expect(ctx.evaluate("dup.child")).toBe(true);
        expect(ctx.evaluate("child")).toBe(false);
    });

    it("a key named __proto__ is a plain key", () => {
        const ctx = new ContextKeyService();
        expect(ctx.evaluate("__proto__")).toBe(false);
        ctx.setRaw("__proto__", true);
        expect(ctx.evaluate("__proto__")).toBe(true);
    });

    it("an array from setContext works with the in operator", () => {
        const ctx = new ContextKeyService();
        ctx.setRaw("ext.supported", ["a.ts", "b.ts"]);
        ctx.setRaw("resourceFilename", "b.ts");
        expect(ctx.evaluate("resourceFilename in ext.supported")).toBe(true);
        expect(ctx.evaluate("resourceFilename not in ext.supported")).toBe(false);
    });
});
