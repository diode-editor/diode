import { describe, expect, it } from "vitest";

import { DisposableStore, DisposableTracker, setDisposableTracker, toDisposable } from "../vs/base/common/lifecycle.ts";

import { ensureNoDisposablesAreLeakedInTestSuite, throwIfLeaked } from "./disposableLeaks.ts";

describe("throwIfLeaked", () => {
    it("silent without leaks, throws with a report on a leak", () => {
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

    it("objects from add are disposed after the test", () => {
        const d = store.add(new DisposableStore());
        expect(d.isDisposed).toBe(false);
        leaked = d;
    });

    it("…and are already disposed by the next test, the tracker is set again", () => {
        expect(leaked?.isDisposed).toBe(true);
        store.add(new DisposableStore());
    });

    it.fails("a leak fails the test", () => {
        new DisposableStore();
    });

    it.fails("a failed test skips the leak check — fails with its own error", () => {
        new DisposableStore();
        throw new Error("own error");
    });
});
