import { describe, expect, it, vi } from "vitest";

import { ContextKeyService } from "./contextKeyService.ts";
import { registerContextKeys } from "./contextKeys.ts";

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
            // Повторный резолв того же мусора идёт мимо кэша — и снова false.
            expect(ctx.evaluate("???invalid!!!")).toBe(false);
        });

        it("бросок внутри выражения — тоже false", () => {
            const ctx = new ContextKeyService();
            expect(ctx.evaluate("editorLangId.missing.deep")).toBe(false);
        });

        it("новый динамический ключ виден выражению, скомпилированному раньше", () => {
            const ctx = new ContextKeyService();
            const expression = "mode_zen";
            expect(ctx.evaluate(expression)).toBe(false);

            registerContextKeys(["mode_zen"]);
            ctx.setRaw("mode_zen", true);
            // Кэш скомпилированных выражений обязан был сброситься вместе с
            // ростом набора имён — иначе функция считает по старому списку
            // параметров и ключ навсегда остаётся ложным.
            expect(ctx.evaluate(expression)).toBe(true);
        });
    });

    describe("onDidChange", () => {
        it("шлёт одно событие на тик с набором изменившихся ключей", async () => {
            const ctx = new ContextKeyService();
            const listener = vi.fn();
            ctx.onDidChange(listener);

            ctx.set("textInputFocus", true);
            ctx.set("listFocus", true);
            ctx.set("editorLangId", "typescript");
            expect(listener).not.toHaveBeenCalled();

            await Promise.resolve();
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0]).toEqual(new Set(["textInputFocus", "listFocus", "editorLangId"]));
        });

        it("запись того же значения событием не считается", async () => {
            const ctx = new ContextKeyService();
            ctx.set("textInputFocus", true);
            await Promise.resolve();

            const listener = vi.fn();
            ctx.onDidChange(listener);
            // Так делает WorkbenchContextKeys перед каждым кейбиндом — без этого
            // фильтра тулбар пересобирался бы на каждое нажатие клавиши.
            ctx.set("textInputFocus", true);
            await Promise.resolve();
            expect(listener).not.toHaveBeenCalled();
        });

        it("reset существующего ключа — событие, несуществующего — нет", async () => {
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

        it("запись из слушателя уезжает в следующий тик", async () => {
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

        it("снятый слушатель и dispose гасят рассылку", async () => {
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
