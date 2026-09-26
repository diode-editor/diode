import { describe, expect, it } from "vitest";

import { type ContextKey, registerContextKeys } from "./contextKeys.ts";
import { ContextKeyService } from "./contextKeyService.ts";

/**
 * Точечные ключи расширений (`supermaven.isProUser` — их приносит команда
 * `setContext`). Вычислитель компилирует выражение через `new Function`, где
 * имена ключей становятся ПАРАМЕТРАМИ, поэтому точка в имени — не косметика:
 * негодное имя разваливает список параметров, то есть все when-выражения
 * сразу. Проверяем и то, что точечные работают, и то, что негодные не заражают
 * соседей.
 */
describe("ContextKeyService — точечные ключи расширений", () => {
    it("точечный ключ виден выражению как чтение свойства", () => {
        const ctx = new ContextKeyService();
        registerContextKeys(["supermaven.isProUser"]);
        expect(ctx.evaluate("supermaven.isProUser")).toBe(false);

        ctx.setRaw("supermaven.isProUser", true);
        expect(ctx.evaluate("supermaven.isProUser")).toBe(true);
    });

    it("несколько ключей одного корня живут рядом", () => {
        const ctx = new ContextKeyService();
        registerContextKeys(["myext.armed", "myext.mode"]);
        ctx.setRaw("myext.armed", true);
        ctx.setRaw("myext.mode", "fast");
        expect(ctx.evaluate("myext.armed && myext.mode == 'fast'")).toBe(true);
        expect(ctx.evaluate("myext.armed && myext.mode == 'slow'")).toBe(false);
    });

    it("глубокий путь собирается во вложенные объекты", () => {
        const ctx = new ContextKeyService();
        registerContextKeys(["a.b.c.d"]);
        ctx.setRaw("a.b.c.d", 7);
        expect(ctx.evaluate("a.b.c.d > 5")).toBe(true);
        expect(ctx.evaluate("a.b.c.d > 9")).toBe(false);
    });

    // Прикладной инвариант: точечный ключ не должен ронять компиляцию выражений,
    // которые его вообще не упоминают.
    it("точечный ключ не мешает встроенным ключам", () => {
        const ctx = new ContextKeyService();
        registerContextKeys(["vendor.thing"]);
        ctx.setRaw("vendor.thing", true);
        ctx.set("textInputFocus", true);
        expect(ctx.evaluate("textInputFocus")).toBe(true);
    });

    it("имя, негодное в параметр, отбрасывается — остальные выражения живут", () => {
        const ctx = new ContextKeyService();
        // Дефис, ведущая цифра и ключевое слово: каждое такое имя параметром быть
        // не может. Значение всё равно хранится — просто не видно вычислителю.
        registerContextKeys(["foo-bar", "2fa", "class", "kept.key"]);
        ctx.setRaw("foo-bar", true);
        ctx.setRaw("2fa", true);
        ctx.setRaw("class", true);
        ctx.setRaw("kept.key", true);

        expect(ctx.get("foo-bar" as ContextKey)).toBe(true);
        expect(ctx.evaluate("kept.key")).toBe(true);
        ctx.set("listFocus", true);
        expect(ctx.evaluate("listFocus")).toBe(true);
    });

    it("негодный сегмент после корня тоже отбрасывается, годные соседи — нет", () => {
        const ctx = new ContextKeyService();
        registerContextKeys(["ns.bad-segment", "ns.good"]);
        ctx.setRaw("ns.bad-segment", true);
        ctx.setRaw("ns.good", true);
        expect(ctx.evaluate("ns.good")).toBe(true);
        expect(ctx.evaluate("ns['bad-segment']")).toBe(false);
    });

    // Плоское значение примитивно — вложить в него нельзя. Побеждает плоский
    // ключ: он объявлен явно, а точечный — производное от чужого setContext.
    it("при столкновении корня с плоским ключом побеждает плоский", () => {
        const ctx = new ContextKeyService();
        registerContextKeys(["dup", "dup.child"]);
        ctx.setRaw("dup", true);
        ctx.setRaw("dup.child", true);
        expect(ctx.evaluate("dup")).toBe(true);
        // `dup.child` читается с boolean → undefined, то есть ложь. Не падение.
        expect(ctx.evaluate("dup.child")).toBe(false);
    });
});
