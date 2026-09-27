/**
 * Пиковый RSS процесса редактора за прогон.
 *
 * Linux: `/proc/<pid>/status` → `VmHWM` (high-water mark резидентной памяти —
 * ядро само держит максимум за жизнь процесса). Опрашиваем раз в ~50 мс, чтобы
 * последнее прочитанное значение пережило внезапную смерть процесса (OOM-kill:
 * после него `/proc/<pid>` уже пуст). На не-Linux — null («—» в отчёте).
 */

import { readFileSync } from "node:fs";

export interface RssSampler {
    /** Останавливает опрос и отдаёт пик в байтах (null — измерить было нечем). */
    stop(): number | null;
}

/** Читает VmHWM (байты) из `/proc/<pid>/status`; null, если процесса/поля нет. */
export function readPeakRss(pid: number): number | null {
    let status: string;
    try {
        status = readFileSync(`/proc/${String(pid)}/status`, "utf8");
    } catch {
        return null;
    }
    const match = /^VmHWM:\s+(\d+)\s+kB$/m.exec(status);
    return match === null ? null : Number(match[1]) * 1024;
}

export function startRssSampler(pid: number, intervalMs = 50): RssSampler {
    if (process.platform !== "linux") {
        return { stop: () => null };
    }
    let peak: number | null = null;
    const sample = () => {
        const value = readPeakRss(pid);
        if (value !== null && (peak === null || value > peak)) peak = value;
    };
    sample();
    const timer = setInterval(sample, intervalMs);
    return {
        stop: () => {
            clearInterval(timer);
            sample();
            return peak;
        },
    };
}
