import { describe, expect, it, vi } from "vitest";

import { ContextKeyService } from "./contextKeyService.ts";

describe("ContextKeyService", () => {
    it("returns undefined for unset keys", () => {
        const ctx = new ContextKeyService();
        expect(ctx.get("textInputFocus")).toBeUndefined();
        expect(ctx.get("listFocus")).toBeUndefined();
    });

    it("set and get a key", () => {
        const ctx = new ContextKeyService();
        ctx.set("textInputFocus", true);
        expect(ctx.get("textInputFocus")).toBe(true);
    });

    it("getRaw reads a key by string — both typed and setRaw", () => {
        const svc = new ContextKeyService();
        svc.set("textInputFocus", true);
        svc.setRaw("ext.thing", ["a", "b"]);
        expect(svc.getRaw("textInputFocus")).toBe(true);
        expect(svc.getRaw("ext.thing")).toEqual(["a", "b"]);
        expect(svc.getRaw("nope")).toBeUndefined();
    });

    it("reset removes a key", () => {
        const ctx = new ContextKeyService();
        ctx.set("listFocus", true);
        ctx.reset("listFocus");
        expect(ctx.get("listFocus")).toBeUndefined();
    });

    it("dispose clears all keys", () => {
        const ctx = new ContextKeyService();
        ctx.set("textInputFocus", true);
        ctx.set("listFocus", true);
        ctx.dispose();
        expect(ctx.get("textInputFocus")).toBeUndefined();
        expect(ctx.get("listFocus")).toBeUndefined();
    });

    describe("evaluate", () => {
        it("evaluates simple true key", () => {
            const ctx = new ContextKeyService();
            ctx.set("textInputFocus", true);
            expect(ctx.evaluate("textInputFocus")).toBe(true);
        });

        it("evaluates simple false key", () => {
            const ctx = new ContextKeyService();
            expect(ctx.evaluate("textInputFocus")).toBe(false);
        });

        it("evaluates negation", () => {
            const ctx = new ContextKeyService();
            ctx.set("textInputFocus", true);
            expect(ctx.evaluate("!textInputFocus")).toBe(false);
            expect(ctx.evaluate("!listFocus")).toBe(true);
        });

        it("evaluates && expression", () => {
            const ctx = new ContextKeyService();
            ctx.set("textInputFocus", true);
            ctx.set("listFocus", true);
            expect(ctx.evaluate("textInputFocus && listFocus")).toBe(true);

            ctx.reset("listFocus");
            expect(ctx.evaluate("textInputFocus && listFocus")).toBe(false);
        });

        it("evaluates || expression", () => {
            const ctx = new ContextKeyService();
            ctx.set("textInputFocus", true);
            expect(ctx.evaluate("textInputFocus || listFocus")).toBe(true);
            expect(ctx.evaluate("listFocus || textInputFocus")).toBe(true);

            ctx.reset("textInputFocus");
            expect(ctx.evaluate("textInputFocus || listFocus")).toBe(false);
        });

        it("evaluates complex expression", () => {
            const ctx = new ContextKeyService();
            ctx.set("textInputFocus", true);
            expect(ctx.evaluate("textInputFocus && !listFocus")).toBe(true);
            expect(ctx.evaluate("!textInputFocus || listFocus")).toBe(false);
        });

        it("returns false for invalid expression", () => {
            const ctx = new ContextKeyService();
            expect(ctx.evaluate("???invalid!!!")).toBe(false);
            // Resolving the same garbage again bypasses the cache and is false again.
            expect(ctx.evaluate("???invalid!!!")).toBe(false);
        });

        it("a throw inside the expression is false too", () => {
            const ctx = new ContextKeyService();
            expect(ctx.evaluate("editorLangId.missing.deep")).toBe(false);
        });

        it("a new key is visible to an expression parsed earlier, without registering the name", () => {
            const ctx = new ContextKeyService();
            const expression = "mode_zen";
            expect(ctx.evaluate(expression)).toBe(false);

            ctx.setRaw("mode_zen", true);
            expect(ctx.evaluate(expression)).toBe(true);
        });
    });

    describe("onDidChange", () => {
        it("fires one event per tick with the set of changed keys", async () => {
            const ctx = new ContextKeyService();
            const listener = vi.fn();
            ctx.onDidChange(listener);

            ctx.set("textInputFocus", true);
            ctx.set("listFocus", true);
            ctx.set("activeOutputChannel", "extensions.host");
            expect(listener).not.toHaveBeenCalled();

            await Promise.resolve();
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0]).toEqual(new Set(["textInputFocus", "listFocus", "activeOutputChannel"]));
        });

        it("writing the same value is not an event", async () => {
            const ctx = new ContextKeyService();
            ctx.set("textInputFocus", true);
            await Promise.resolve();

            const listener = vi.fn();
            ctx.onDidChange(listener);
            // WorkbenchContextKeys does this before every keybinding.
            ctx.set("textInputFocus", true);
            await Promise.resolve();
            expect(listener).not.toHaveBeenCalled();
        });

        it("reset of an existing key fires an event, of a missing one does not", async () => {
            const ctx = new ContextKeyService();
            ctx.set("listFocus", true);
            await Promise.resolve();

            const listener = vi.fn();
            ctx.onDidChange(listener);
            ctx.reset("listFocus");
            await Promise.resolve();
            expect(listener).toHaveBeenCalledTimes(1);

            listener.mockClear();
            ctx.reset("listFocus");
            await Promise.resolve();
            expect(listener).not.toHaveBeenCalled();
        });

        it("a write from a listener moves to the next tick", async () => {
            const ctx = new ContextKeyService();
            const seen: string[][] = [];
            ctx.onDidChange((changed) => {
                seen.push([...changed]);
                if (changed.has("listFocus")) ctx.set("textInputFocus", true);
            });

            ctx.set("listFocus", true);
            await Promise.resolve();
            await Promise.resolve();
            expect(seen).toEqual([["listFocus"], ["textInputFocus"]]);
        });

        it("a removed listener and dispose stop delivery", async () => {
            const ctx = new ContextKeyService();
            const listener = vi.fn();
            const subscription = ctx.onDidChange(listener);
            subscription.dispose();
            ctx.set("listFocus", true);
            await Promise.resolve();
            expect(listener).not.toHaveBeenCalled();

            ctx.onDidChange(listener);
            ctx.dispose();
            ctx.set("textInputFocus", true);
            await Promise.resolve();
            expect(listener).not.toHaveBeenCalled();
        });
    });
});

describe("ContextKeyService — overlay ('what if')", () => {
    it("overrides values during evaluation without changing the keys themselves", () => {
        const contextKeys = new ContextKeyService();
        contextKeys.set("listFocus", false);
        contextKeys.set("tier", "legacy");
        expect(contextKeys.evaluate("listFocus && tier == 'legacy'", { listFocus: true })).toBe(true);
        expect(contextKeys.evaluate("listFocus")).toBe(false);
        expect(contextKeys.get("listFocus")).toBe(false);
        expect(contextKeys.evaluate("tier == 'kitty'", { tier: "kitty" })).toBe(true);
        expect(contextKeys.evaluate("tier == 'legacy'", {})).toBe(true); // an empty overlay behaves like none
    });

    it("works for dotted extension keys too", () => {
        const contextKeys = new ContextKeyService();
        expect(contextKeys.evaluate("overlayExt.flag")).toBe(false);
        expect(contextKeys.evaluate("overlayExt.flag", { "overlayExt.flag": true })).toBe(true);
    });
});
