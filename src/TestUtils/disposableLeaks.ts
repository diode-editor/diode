import { afterEach, beforeEach } from "vitest";

import {
    DisposableStore,
    DisposableTracker,
    type IDisposable,
    setDisposableTracker,
} from "../vs/base/common/lifecycle.ts";

/** Бросает с отчётом, если под трекером остались неосвобождённые корни. */
export function throwIfLeaked(tracker: DisposableTracker): void {
    const report = tracker.computeLeakingDisposables();
    if (report) throw new Error(`There are ${String(report.leaks.length)} undisposed disposables!${report.details}`);
}

/**
 * Учёт утечек на сьют — аналог хелпера эталона (`base/test/common/utils.ts`).
 * Зовётся в начале `describe`: перед каждым тестом ставит трекер, после —
 * снимает его и валит тест, если что-то созданное в тесте осталось
 * неосвобождённым. Упавший тест утечки не проверяет — его ошибка важнее.
 * Возвращает `add`: объекты самого теста, освобождаемые после него.
 *
 * Включается храповиком по сьютам, не глобально (docs/TODO/Lifecycle.md, §7).
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
