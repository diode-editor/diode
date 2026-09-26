import { describe, expect, it } from "vitest";

import { type ContextKey, registerContextKeys } from "./contextKeys.ts";
import { ContextKeyService } from "./contextKeyService.ts";

/**
 * Точечные ключи расширений (`supermaven.isProUser` — их приносит команда
 * `setContext`). Вычислитель компилирует выражение в `with (__scope) { … }`, так
 * что имя ключа — не параметр функции, а свойство объекта: любое имя ложится в
 * скоуп, не роняя компиляцию (а уронив её, оно убило бы ВСЕ when-выражения
 * сразу, не только своё). Проверяем и раскрытие точечных имён, и что
 * экзотические имена соседей не заражают.
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

    // Имена, которые в выражении не написать словом (дефис — это минус, ведущая
    // цифра и ключевое слово — синтаксическая ошибка). Такое выражение честно
    // ложно, а главное — соседние выражения продолжают считаться: до перехода на
    // `with` любое из этих имён роняло компиляцию скоупа целиком.
    it("экзотическое имя ключа не заражает остальные выражения", () => {
        const ctx = new ContextKeyService();
        registerContextKeys(["foo-bar", "2fa", "class", "kept.key"]);
        ctx.setRaw("foo-bar", true);
        ctx.setRaw("2fa", true);
        ctx.setRaw("class", true);
        ctx.setRaw("kept.key", true);

        expect(ctx.get("foo-bar" as ContextKey)).toBe(true);
        expect(ctx.evaluate("foo-bar")).toBe(false);
        expect(ctx.evaluate("class")).toBe(false);
        expect(ctx.evaluate("kept.key")).toBe(true);
        ctx.set("listFocus", true);
        expect(ctx.evaluate("listFocus")).toBe(true);
    });

    it("сегмент после корня — обычное свойство, скобочная запись до него достаёт", () => {
        const ctx = new ContextKeyService();
        registerContextKeys(["ns.bad-segment", "ns.good"]);
        ctx.setRaw("ns.bad-segment", true);
        ctx.setRaw("ns.good", true);
        expect(ctx.evaluate("ns.good")).toBe(true);
        expect(ctx.evaluate("ns['bad-segment']")).toBe(true);
    });

    // У скоупа нет прототипа (`Object.create(null)`). Ключ с именем `__proto__`
    // приходит от расширения как любой другой, и на обычном объекте запись по
    // нему молча уходит в сеттер прототипа: значение не сохранилось бы, а чтение
    // вернуло бы прототип — то есть истину вместо записанной лжи.
    it("ключ с именем __proto__ хранится значением, а не уезжает в прототип", () => {
        const ctx = new ContextKeyService();
        registerContextKeys(["__proto__"]);
        ctx.setRaw("__proto__", false);
        expect(ctx.evaluate("__proto__")).toBe(false);
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
