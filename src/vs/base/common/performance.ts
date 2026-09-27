/**
 * Вехи старта поверх стандартного `performance.mark` (аналог
 * `vs/base/common/performance.ts` upstream). Метки ставятся по всему пути
 * открытия файла (`main.ts` → workbench → textfile), но **без включения — это
 * no-op**: в обычном запуске ни одна метка не записывается, а стоимость вызова —
 * одна проверка флага. Включает трассу `src/vs/diode/startupTrace.ts` по env
 * `DIODE_STARTUP_TRACE`; он же выгружает метки в файл, который читает бенч
 * `e2e/bench/benchOpen.ts` (лестница вех рядом с чёрным ящиком).
 *
 * Имена — `<область>:<веха>` (`main:config-loaded`, `textfile:read`,
 * `frame`); префикс `diode/` в `performance` отделяет наши метки от чужих.
 */

const MARK_PREFIX = "diode/";

let enabled = false;

/** Включает запись меток; до вызова {@link mark} ничего не пишет. */
export function enablePerformanceMarks(): void {
    enabled = true;
}

export function isPerformanceMarksEnabled(): boolean {
    return enabled;
}

/**
 * Ставит веху `name` с текущим временем (`performance.now()`, мс от
 * `performance.timeOrigin` — старта процесса). `detail` — произвольные
 * данные вехи (номер кадра, размер файла), попадают в выгрузку как есть.
 */
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

/** Все наши метки в порядке постановки (чужие `performance.mark` отфильтрованы). */
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

/** Сбрасывает наши метки и выключает запись — для тестов. */
export function resetPerformanceMarks(): void {
    for (const entry of performance.getEntriesByType("mark")) {
        if (entry.name.startsWith(MARK_PREFIX)) performance.clearMarks(entry.name);
    }
    enabled = false;
}
