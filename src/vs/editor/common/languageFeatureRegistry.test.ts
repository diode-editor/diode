import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../base/common/uri.ts";

import { type ILanguageFeatureTarget, LanguageFeatureRegistry } from "./languageFeatureRegistry.ts";

const ts: ILanguageFeatureTarget = { uri: Uri.file("/w/a.ts"), languageId: "typescript" };
const md: ILanguageFeatureTarget = { uri: Uri.file("/w/b.md"), languageId: "markdown" };

describe("LanguageFeatureRegistry", () => {
    it("отдаёт только подошедших документу провайдеров", () => {
        const registry = new LanguageFeatureRegistry<string>();
        registry.register("typescript", "ts");
        registry.register("markdown", "md");

        expect(registry.ordered(ts)).toEqual(["ts"]);
        expect(registry.ordered(md)).toEqual(["md"]);
        expect(registry.has(ts)).toBe(true);
        expect(registry.has({ uri: Uri.file("/w/c.py"), languageId: "python" })).toBe(false);
    });

    it("порядок: выше score — первым, при равном — более поздняя регистрация", () => {
        const registry = new LanguageFeatureRegistry<string>();
        registry.register("*", "any-old");
        registry.register("typescript", "exact-old");
        registry.register("*", "any-new");
        registry.register("typescript", "exact-new");

        expect(registry.ordered(ts)).toEqual(["exact-new", "exact-old", "any-new", "any-old"]);
        expect(registry.ordered(md)).toEqual(["any-new", "any-old"]);
    });

    it("порядок не зависит от позиции записей после прошлой сортировки", () => {
        const registry = new LanguageFeatureRegistry<string>();
        registry.register("markdown", "md");
        registry.register("*", "any");
        // Под ts «md» уезжает в хвост (score 0); под md он снова первый.
        expect(registry.ordered(ts)).toEqual(["any"]);
        expect(registry.ordered(md)).toEqual(["md", "any"]);
    });

    it("эксклюзивный селектор глушит остальных, но только когда подошёл", () => {
        const registry = new LanguageFeatureRegistry<string>();
        registry.register("typescript", "before");
        registry.register({ language: "typescript", exclusive: true }, "exclusive");
        registry.register("*", "after");

        expect(registry.ordered(ts)).toEqual(["exclusive"]);
        expect(registry.ordered(md)).toEqual(["after"]);
    });

    it("эксклюзивный глушит и записи, стоящие после него в списке", () => {
        const registry = new LanguageFeatureRegistry<string>();
        registry.register({ language: "*", exclusive: true }, "exclusive");
        registry.register("typescript", "later");
        // По score «later» (10) обогнал бы «exclusive» (5), но эксклюзивный подошёл
        // первым в обходе — и обнулил всех, включая ещё не посчитанных.
        expect(registry.ordered(ts)).toEqual(["exclusive"]);
        expect(registry.ordered(md)).toEqual(["exclusive"]);
    });

    it("onDidChange — на каждую регистрацию и снятие, а не только на 0↔1", () => {
        const registry = new LanguageFeatureRegistry<string>();
        const listener = vi.fn();
        registry.onDidChange(listener);

        const first = registry.register("typescript", "a");
        const second = registry.register("typescript", "b");
        second.dispose();
        first.dispose();

        expect(listener.mock.calls).toEqual([[1], [2], [1], [0]]);
    });

    it("повторный dispose регистрации — no-op и не трогает чужие", () => {
        const registry = new LanguageFeatureRegistry<string>();
        const listener = vi.fn();
        const first = registry.register("typescript", "a");
        registry.register("typescript", "b");
        registry.onDidChange(listener);

        first.dispose();
        first.dispose();

        expect(listener).toHaveBeenCalledTimes(1);
        expect(registry.ordered(ts)).toEqual(["b"]);
    });

    it("отписка от onDidChange снимает только своего слушателя", () => {
        const registry = new LanguageFeatureRegistry<string>();
        const kept = vi.fn();
        const removed = vi.fn();
        registry.onDidChange(kept);
        const sub = registry.onDidChange(removed);
        sub.dispose();
        sub.dispose();

        registry.register("*", "a");

        expect(kept).toHaveBeenCalledTimes(1);
        expect(removed).not.toHaveBeenCalled();
    });

    it("слушатель, отписавшийся во время рассылки, не ломает обход остальных", () => {
        const registry = new LanguageFeatureRegistry<string>();
        const second = vi.fn();
        const sub = registry.onDidChange(() => {
            sub.dispose();
        });
        registry.onDidChange(second);

        registry.register("*", "a");

        expect(second).toHaveBeenCalledTimes(1);
    });

    it("кэш кандидата сбрасывается регистрацией и снятием", () => {
        const registry = new LanguageFeatureRegistry<string>();
        expect(registry.ordered(ts)).toEqual([]);

        const sub = registry.register("typescript", "a");
        expect(registry.ordered(ts)).toEqual(["a"]);

        sub.dispose();
        expect(registry.ordered(ts)).toEqual([]);
    });

    it("кэш кандидата различает смену языка у того же uri", () => {
        const registry = new LanguageFeatureRegistry<string>();
        registry.register("typescript", "ts");
        registry.register("plaintext", "txt");

        expect(registry.ordered(ts)).toEqual(["ts"]);
        expect(registry.ordered({ uri: ts.uri, languageId: "plaintext" })).toEqual(["txt"]);
    });

    it("кэш кандидата различает смену uri при том же языке", () => {
        const registry = new LanguageFeatureRegistry<string>();
        registry.register({ pattern: "**/a.ts" }, "a");

        expect(registry.ordered(ts)).toEqual(["a"]);
        expect(registry.ordered({ uri: Uri.file("/w/other.ts"), languageId: "typescript" })).toEqual([]);
    });
});
