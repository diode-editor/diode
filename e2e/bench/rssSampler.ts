/**
 * Пик RSS — `VmHWM` из `/proc/<pid>/status`. Опрос раз в ~50 мс — чтобы значение пережило
 * OOM-kill, после которого `/proc/<pid>` уже пуст. На не-Linux — null.
 */

import { readFileSync } from "node:fs";

export interface RssSampler {
    /** Пик в байтах; null — измерить было нечем. */
    stop(): number | null;
}

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
