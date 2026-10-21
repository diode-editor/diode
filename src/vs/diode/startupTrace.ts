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
 * Times are ms since `performance.timeOrigin`; `timeOrigin` itself (epoch ms) is in the file too, so the bench can
 * align the ladder with black-box timestamps. The DI instantiation trace has its own flag: recording costs ≈2 ms in
 * the DI window and would skew the bench and perf-gate numbers, which always run under the trace.
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
 * The mark is set after the stdout write (synchronous for a TTY on Linux). It is set for an unchanged frame too:
 * the bench matches frames by the marks around them, not by number.
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
    /** Epoch ms. */
    readonly timeOrigin: number;
    /** Ms since timeOrigin. */
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

/** A write failure is no reason to crash the editor. */
export function writeStartupTrace(path: string, complete: boolean): void {
    try {
        writeFileSync(path, JSON.stringify(buildStartupTrace(complete)) + "\n");
    } catch {
        // the trace is diagnostics; the editor doesn't depend on it
    }
}
