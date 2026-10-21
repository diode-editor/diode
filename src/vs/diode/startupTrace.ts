import { writeFileSync } from "node:fs";
import { performance as nodePerformance } from "node:perf_hooks";

import type { Point } from "@tuidom/core/common/geometryPromitives";
import type { Grid } from "@tuidom/core/rendering/grid";
import { NodeTerminalBackend } from "@tuidom/terminal-backend/nodeTerminalBackend";

import { enablePerformanceMarks, getMarks, type IPerformanceMark, mark } from "../base/common/performance.ts";
import {
    enableInstantiationTrace,
    getInstantiationTracer,
    type IInstantiationTraceEntry,
} from "../platform/instantiation/common/instantiationTrace.ts";

/**
 * Время — мс от `performance.timeOrigin`; сам `timeOrigin` (epoch-мс) тоже в файле, чтобы бенч совместил
 * лестницу с таймстемпами чёрного ящика. Трасса созданий DI — отдельным флагом: запись стоит ≈2 мс в окне DI
 * и сдвигала бы цифры бенча и перф-гейта, которые всегда идут под трассой.
 */

export const STARTUP_TRACE_ENV = "DIODE_STARTUP_TRACE";
export const STARTUP_TRACE_INSTANTIATIONS_ENV = "DIODE_STARTUP_TRACE_INSTANTIATIONS";

export function startupTracePath(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
    const value = env[STARTUP_TRACE_ENV];
    return value !== undefined && value.length > 0 ? value : null;
}

export function setupStartupTrace(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
    const path = startupTracePath(env);
    if (path !== null) {
        enablePerformanceMarks();
        if (env[STARTUP_TRACE_INSTANTIATIONS_ENV] === "1") enableInstantiationTrace();
    }
    return path;
}

/**
 * Веха — после записи в stdout (для TTY на Linux синхронной). Ставится и на кадр без изменений: бенч
 * сопоставляет кадры по вехам вокруг них, а не по номерам.
 */
export class TracingNodeTerminalBackend extends NodeTerminalBackend {
    private frames = 0;

    public override renderFrame(grid: Grid, cursorPosition: Point | null): void {
        super.renderFrame(grid, cursorPosition);
        this.frames++;
        mark("frame", { frame: this.frames });
    }
}

export interface IStartupTrace {
    readonly pid: number;
    /** Epoch-мс. */
    readonly timeOrigin: number;
    /** Мс от timeOrigin. */
    readonly nodeTiming: Readonly<Record<string, number>>;
    readonly marks: readonly IPerformanceMark[];
    readonly instantiations: readonly IInstantiationTraceEntry[];
    readonly complete: boolean;
}

export function buildStartupTrace(complete: boolean): IStartupTrace {
    const nodeTiming: Record<string, number> = {};
    for (const [key, value] of Object.entries(nodePerformance.nodeTiming.toJSON() as Record<string, unknown>)) {
        if (typeof value === "number") nodeTiming[key] = value;
    }
    return {
        pid: process.pid,
        timeOrigin: performance.timeOrigin,
        nodeTiming,
        marks: getMarks(),
        instantiations: getInstantiationTracer()?.getEntries() ?? [],
        complete,
    };
}

/** Сбой записи — не повод ронять редактор. */
export function writeStartupTrace(path: string, complete: boolean): void {
    try {
        writeFileSync(path, JSON.stringify(buildStartupTrace(complete)) + "\n");
    } catch {
        // трасса — диагностика; редактор от неё не зависит
    }
}
