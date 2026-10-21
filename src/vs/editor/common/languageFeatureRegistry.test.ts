import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../base/common/uri.ts";

import { type ILanguageFeatureTarget, LanguageFeatureRegistry } from "./languageFeatureRegistry.ts";

const ts: ILanguageFeatureTarget = { uri: Uri.file("/w/a.ts"), languageId: "typescript" };
const md: ILanguageFeatureTarget = { uri: Uri.file("/w/b.md"), languageId: "markdown" };

describe("LanguageFeatureRegistry", () => {
    it("returns only providers that match the document", () => {
        const registry = new LanguageFeatureRegistry<string>();
        registry.register("typescript", "ts");
        registry.register("markdown", "md");

        expect(registry.ordered(ts)).toEqual(["ts"]);
        expect(registry.ordered(md)).toEqual(["md"]);
        expect(registry.has(ts)).toBe(true);
        expect(registry.has({ uri: Uri.file("/w/c.py"), languageId: "python" })).toBe(false);
    });

    it("order: higher score first, on a tie the later registration", () => {
        const registry = new LanguageFeatureRegistry<string>();
        registry.register("*", "any-old");
        registry.register("typescript", "exact-old");
        registry.register("*", "any-new");
        registry.register("typescript", "exact-new");

        expect(registry.ordered(ts)).toEqual(["exact-new", "exact-old", "any-new", "any-old"]);
        expect(registry.ordered(md)).toEqual(["any-new", "any-old"]);
    });

    it("order does not depend on entry positions after the previous sort", () => {
        const registry = new LanguageFeatureRegistry<string>();
        registry.register("markdown", "md");
        registry.register("*", "any");
        expect(registry.ordered(ts)).toEqual(["any"]);
        expect(registry.ordered(md)).toEqual(["md", "any"]);
    });

    it("an exclusive selector silences the others, but only when it matches", () => {
        const registry = new LanguageFeatureRegistry<string>();
        registry.register("typescript", "before");
        registry.register({ language: "typescript", exclusive: true }, "exclusive");
        registry.register("*", "after");

        expect(registry.ordered(ts)).toEqual(["exclusive"]);
        expect(registry.ordered(md)).toEqual(["after"]);
    });

    it("an exclusive one also silences entries after it in the list", () => {
        const registry = new LanguageFeatureRegistry<string>();
        registry.register({ language: "*", exclusive: true }, "exclusive");
        registry.register("typescript", "later");
        // By score "later" (10) would beat "exclusive" (5), but the exclusive one zeroes out all the others.
        expect(registry.ordered(ts)).toEqual(["exclusive"]);
        expect(registry.ordered(md)).toEqual(["exclusive"]);
    });

    it("onDidChange fires on every registration and removal, not only on 0↔1", () => {
        const registry = new LanguageFeatureRegistry<string>();
        const listener = vi.fn();
        registry.onDidChange(listener);

        const first = registry.register("typescript", "a");
        const second = registry.register("typescript", "b");
        second.dispose();
        first.dispose();

        expect(listener.mock.calls).toEqual([[1], [2], [1], [0]]);
    });

    it("disposing a registration twice is a no-op and leaves others alone", () => {
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

    it("unsubscribing from onDidChange removes only its own listener", () => {
        const registry = new LanguageFeatureRegistry<string>();
        const kept = vi.fn();
        const removed = vi.fn();
        const sub = registry.onDidChange(removed);
        registry.onDidChange(kept);
        sub.dispose();
        sub.dispose();

        registry.register("*", "a");

        expect(kept).toHaveBeenCalledTimes(1);
        expect(removed).not.toHaveBeenCalled();
    });

    it("a listener that unsubscribes during dispatch does not break iteration over the rest", () => {
        const registry = new LanguageFeatureRegistry<string>();
        const second = vi.fn();
        const sub = registry.onDidChange(() => {
            sub.dispose();
        });
        registry.onDidChange(second);

        registry.register("*", "a");

        expect(second).toHaveBeenCalledTimes(1);
    });

    it("the candidate cache is reset by registration and removal", () => {
        const registry = new LanguageFeatureRegistry<string>();
        expect(registry.ordered(ts)).toEqual([]);

        const sub = registry.register("typescript", "a");
        expect(registry.ordered(ts)).toEqual(["a"]);

        sub.dispose();
        expect(registry.ordered(ts)).toEqual([]);
    });

    it("a repeated query for the same document does not recompute score", () => {
        const registry = new LanguageFeatureRegistry<string>();
        let reads = 0;
        registry.register(
            {
                get language() {
                    reads++;
                    return "typescript";
                },
            },
            "ts",
        );

        expect(registry.ordered(ts)).toEqual(["ts"]);
        const afterFirst = reads;
        expect(registry.has(ts)).toBe(true);
        expect(reads).toBe(afterFirst);
    });

    it("the candidate cache tells a language change on the same uri apart", () => {
        const registry = new LanguageFeatureRegistry<string>();
        registry.register("typescript", "ts");
        registry.register("plaintext", "txt");

        expect(registry.ordered(ts)).toEqual(["ts"]);
        expect(registry.ordered({ uri: ts.uri, languageId: "plaintext" })).toEqual(["txt"]);
    });

    it("the candidate cache tells a uri change with the same language apart", () => {
        const registry = new LanguageFeatureRegistry<string>();
        registry.register({ pattern: "**/a.ts" }, "a");

        expect(registry.ordered(ts)).toEqual(["a"]);
        expect(registry.ordered({ uri: Uri.file("/w/other.ts"), languageId: "typescript" })).toEqual([]);
    });

    describe("orderedGroups", () => {
        it("groups of equal score — by descending score, newest first within a group", () => {
            const registry = new LanguageFeatureRegistry<string>();
            registry.register("*", "any-old");
            registry.register("typescript", "exact-old");
            registry.register("*", "any-new");
            registry.register("typescript", "exact-new");
            registry.register("markdown", "md");

            expect(registry.orderedGroups(ts)).toEqual([
                ["exact-new", "exact-old"],
                ["any-new", "any-old"],
            ]);
            expect(registry.orderedGroups(md)).toEqual([["md"], ["any-new", "any-old"]]);
        });

        it("nothing matches — empty", () => {
            const registry = new LanguageFeatureRegistry<string>();
            registry.register("markdown", "md");
            expect(registry.orderedGroups(ts)).toEqual([]);
        });

        it("an exclusive selector — the only group", () => {
            const registry = new LanguageFeatureRegistry<string>();
            registry.register("typescript", "exact");
            registry.register({ language: "typescript", exclusive: true }, "exclusive");
            registry.register("*", "any");
            expect(registry.orderedGroups(ts)).toEqual([["exclusive"]]);
        });
    });
});
