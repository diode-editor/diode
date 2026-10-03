import { describe, expect, it } from "vitest";

import { ContextKeyService } from "./contextKeyService.ts";

/**
 * Ключи расширений (`supermaven.isProUser` — их приносит команда `setContext`).
 * Вычислитель читает имя ключа целиком, каким бы оно ни было: точка, дефис,
 * ведущая цифра, ключевое слово JS — просто символы имени. Регистрировать имя
 * заранее не нужно.
 */
describe("ContextKeyService — ключи расширений", () => {
    it("точечный ключ читается целиком", () => {
        const ctx = new ContextKeyService();
        expect(ctx.evaluate("supermaven.isProUser")).toBe(false);

        ctx.setRaw("supermaven.isProUser", true);
        expect(ctx.evaluate("supermaven.isProUser")).toBe(true);
    });

    it("несколько ключей одного корня живут рядом", () => {
        const ctx = new ContextKeyService();
        ctx.setRaw("myext.armed", true);
        ctx.setRaw("myext.mode", "fast");
        expect(ctx.evaluate("myext.armed && myext.mode == 'fast'")).toBe(true);
        expect(ctx.evaluate("myext.armed && myext.mode == 'slow'")).toBe(false);
        expect(ctx.evaluate("myext.armed && myext.mode == fast")).toBe(true);
    });

    it("имена, которые JS словом не написал бы, достижимы", () => {
        const ctx = new ContextKeyService();
        ctx.setRaw("foo-bar", true);
        ctx.setRaw("2fa", true);
        ctx.setRaw("class", true);
        expect(ctx.evaluate("foo-bar && 2fa && class")).toBe(true);
    });

    it("плоский ключ и точечный с тем же корнем не мешают друг другу", () => {
        const ctx = new ContextKeyService();
        ctx.setRaw("dup", false);
        ctx.setRaw("dup.child", true);
        expect(ctx.evaluate("dup")).toBe(false);
        expect(ctx.evaluate("dup.child")).toBe(true);
        expect(ctx.evaluate("child")).toBe(false);
    });

    it("ключ с именем __proto__ — обычный ключ", () => {
        const ctx = new ContextKeyService();
        expect(ctx.evaluate("__proto__")).toBe(false);
        ctx.setRaw("__proto__", true);
        expect(ctx.evaluate("__proto__")).toBe(true);
    });

    it("массив из setContext работает с оператором in", () => {
        const ctx = new ContextKeyService();
        ctx.setRaw("ext.supported", ["a.ts", "b.ts"]);
        ctx.setRaw("resourceFilename", "b.ts");
        expect(ctx.evaluate("resourceFilename in ext.supported")).toBe(true);
        expect(ctx.evaluate("resourceFilename not in ext.supported")).toBe(false);
    });
});
