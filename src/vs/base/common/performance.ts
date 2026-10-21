/**
 * Вехи старта; без `enablePerformanceMarks()` — no-op ценой одной проверки флага.
 * Включает `DIODE_STARTUP_TRACE` (`src/vs/diode/startupTrace.ts`). Имена —
 * `<область>:<веха>`.
 */

const MARK_PREFIX = "diode/";

let enabled = false;

export function enablePerformanceMarks(): void {
    enabled = true;
}

export function isPerformanceMarksEnabled(): boolean {
    return enabled;
}

export function mark(name: string, detail?: Readonly<Record<string, unknown>>): void {
    if (!enabled) return;
    // Без detail node кладёт в запись null — getMarks его не отдаёт.
    performance.mark(MARK_PREFIX + name, { detail });
}

export interface IPerformanceMark {
    readonly name: string;
    /** мс от `performance.timeOrigin`. */
    readonly startTime: number;
    readonly detail?: unknown;
}

export function getMarks(): IPerformanceMark[] {
    const result: IPerformanceMark[] = [];
    for (const entry of performance.getEntriesByType("mark")) {
        if (!entry.name.startsWith(MARK_PREFIX)) continue;
        const detail: unknown = (entry as PerformanceMark).detail;
        result.push(
            detail === null
                ? { name: entry.name.slice(MARK_PREFIX.length), startTime: entry.startTime }
                : { name: entry.name.slice(MARK_PREFIX.length), startTime: entry.startTime, detail },
        );
    }
    return result;
}

export function resetPerformanceMarks(): void {
    for (const entry of performance.getEntriesByType("mark")) {
        if (entry.name.startsWith(MARK_PREFIX)) performance.clearMarks(entry.name);
    }
    enabled = false;
}
