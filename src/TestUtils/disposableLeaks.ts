import { afterEach, beforeEach } from "vitest";

import {
    DisposableStore,
    DisposableTracker,
    type IDisposable,
    setDisposableTracker,
} from "../vs/base/common/lifecycle.ts";

export function throwIfLeaked(tracker: DisposableTracker): void {
    const report = tracker.computeLeakingDisposables();
    if (report) throw new Error(`There are ${String(report.leaks.length)} undisposed disposables!${report.details}`);
}

/**
 * Like the upstream helper (`base/test/common/utils.ts`); call it at the start of `describe`.
 * `add` registers the test's own objects, disposed after it.
 */
export function ensureNoDisposablesAreLeakedInTestSuite(): { add<T extends IDisposable>(o: T): T } {
    let tracker = new DisposableTracker();
    let store = new DisposableStore();
    beforeEach(() => {
        store = new DisposableStore();
        tracker = new DisposableTracker();
        setDisposableTracker(tracker);
    });
    afterEach((context) => {
        store.dispose();
        setDisposableTracker(null);
        if (context.task.result?.state !== "fail") throwIfLeaked(tracker);
    });
    return { add: (o) => store.add(o) };
}
