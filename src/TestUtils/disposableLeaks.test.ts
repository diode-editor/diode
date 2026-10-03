import { describe, expect, it } from "vitest";

import { DisposableStore, DisposableTracker, setDisposableTracker, toDisposable } from "../vs/base/common/lifecycle.ts";

import { ensureNoDisposablesAreLeakedInTestSuite, throwIfLeaked } from "./disposableLeaks.ts";

describe("throwIfLeaked", () => {
    it("молчит без утечек и бросает с отчётом при утечке", () => {
        const tracker = new DisposableTracker();
        setDisposableTracker(tracker);
        const kept = new DisposableStore();
        toDisposable(() => undefined).dispose();
        setDisposableTracker(null);

        expect(() => {
            throwIfLeaked(tracker);
        }).toThrow(/^There are 1 undisposed disposables!\n\n==== Leaking disposable 1\/1: DisposableStore/);
        setDisposableTracker(tracker);
        kept.dispose();
        setDisposableTracker(null);
        expect(() => {
            throwIfLeaked(tracker);
        }).not.toThrow();
    });
});

describe("ensureNoDisposablesAreLeakedInTestSuite", () => {
    const store = ensureNoDisposablesAreLeakedInTestSuite();
    let leaked: DisposableStore | undefined;

    it("объекты из add освобождаются после теста", () => {
        const d = store.add(new DisposableStore());
        expect(d.isDisposed).toBe(false);
        leaked = d;
    });

    it("…и к следующему тесту уже освобождены, трекер снова стоит", () => {
        expect(leaked?.isDisposed).toBe(true);
        store.add(new DisposableStore());
    });

    it.fails("утечка валит тест", () => {
        new DisposableStore();
    });

    it.fails("упавший тест утечки не проверяет — падает своей ошибкой", () => {
        new DisposableStore();
        throw new Error("своя ошибка");
    });
});
