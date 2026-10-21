/**
 * Table of DI instantiations at startup (counterpart of upstream's "Developer: Startup Performance")
 * from `DIODE_STARTUP_TRACE` traces; medians across multiple traces.
 *
 *   npm run bench:open -- --sizes=small --runs=15 --keep-traces=/tmp/traces
 *   npm run bench:services -- /tmp/traces/*.json [--sort=self|inclusive|start] [--top=40] [--min=0.3]
 */

import { readFileSync } from "node:fs";

import type { IInstantiationTraceEntry } from "../../src/vs/platform/instantiation/common/instantiationTrace.ts";

import { type IStartupTrace, ladderFromTrace, parseTrace } from "./startupLadder.ts";
import { median } from "./stats.ts";

/** Ladder windows: an instantiation belongs to the window in which it started. */
const WINDOWS: readonly { readonly key: string; readonly label: string }[] = [
    { key: "mainStart", label: "before DI" },
    { key: "containerCreated", label: "DI → mounted" },
    { key: "workbenchMounted", label: "mounted → text" },
    { key: "frameWithText", label: "text → highlight" },
    { key: "frameWithHighlight", label: "after highlight" },
];

function windowOf(trace: IStartupTrace, start: number): string {
    const ladder = ladderFromTrace(trace, trace.timeOrigin);
    let label = WINDOWS[0].label;
    for (const w of WINDOWS) {
        const at = ladder[w.key];
        if (typeof at === "number" && start >= at) label = w.label;
    }
    return label;
}

interface Row {
    readonly id: string;
    readonly self: number;
    readonly inclusive: number;
    readonly start: number;
    readonly depth: number;
    readonly window: string;
    readonly requester: string;
    readonly phase: string | null;
    readonly contribution: boolean;
    readonly runs: number;
}

/** Medians across traces; the key is the token id (created at most once per run). */
export function aggregate(traces: readonly IStartupTrace[]): Row[] {
    const byId = new Map<string, { entries: IInstantiationTraceEntry[]; windows: string[] }>();
    for (const trace of traces) {
        for (const entry of trace.instantiations) {
            let bucket = byId.get(entry.id);
            if (bucket === undefined) {
                bucket = { entries: [], windows: [] };
                byId.set(entry.id, bucket);
            }
            bucket.entries.push(entry);
            bucket.windows.push(windowOf(trace, entry.start));
        }
    }
    const rows: Row[] = [];
    for (const [id, { entries, windows }] of byId) {
        const first = entries[0];
        rows.push({
            id,
            self: median(entries.map((e) => e.self)),
            inclusive: median(entries.map((e) => e.inclusive)),
            start: median(entries.map((e) => e.start)),
            depth: first.depth,
            window: mode(windows),
            requester: mode(entries.map((e) => e.requester)),
            phase: first.phase,
            contribution: first.contribution,
            runs: entries.length,
        });
    }
    return rows;
}

function mode(values: readonly string[]): string {
    const counts = new Map<string, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    let best = values[0];
    for (const [v, n] of counts) if (n > (counts.get(best) ?? 0)) best = v;
    return best;
}

const ms = (v: number): string => v.toFixed(1);

export function renderTables(
    rows: readonly Row[],
    traces: number,
    opts: { sort: string; top: number; min: number },
): string {
    const out: string[] = [];
    out.push(`Traces: ${String(traces)}; numbers are medians, ms (ms from process start in the "start" column).`, "");

    // Per-window totals: inclusive time of top-level instantiations — how much of the window went to DI.
    out.push("| window | instantiations | top level, inclusive |", "|---|--:|--:|");
    for (const w of WINDOWS) {
        const inWindow = rows.filter((r) => r.window === w.label);
        const top = inWindow.filter((r) => r.depth === 0).reduce((sum, r) => sum + r.inclusive, 0);
        out.push(`| ${w.label} | ${String(inWindow.length)} | ${ms(top)} |`);
    }
    out.push("");

    const contributions = rows.filter((r) => r.contribution).sort((a, b) => a.start - b.start);
    out.push("Contributions (in creation order):", "");
    out.push("| contribution | phase | window | inclusive | self | start |", "|---|---|---|--:|--:|--:|");
    for (const r of contributions) {
        out.push(`| ${r.id} | ${r.phase ?? "—"} | ${r.window} | ${ms(r.inclusive)} | ${ms(r.self)} | ${ms(r.start)} |`);
    }
    out.push("");

    const key = opts.sort === "inclusive" ? "inclusive" : opts.sort === "start" ? "start" : "self";
    const sorted = rows
        .filter((r) => r.self >= opts.min || r.inclusive >= opts.min)
        .sort((a, b) => (key === "start" ? a.start - b.start : b[key] - a[key]))
        .slice(0, opts.top);
    out.push(`Instantiations (sort: ${key}, threshold ${String(opts.min)} ms, top ${String(opts.top)}):`, "");
    out.push(
        "| what | self | inclusive | start | window | requested by | phase | traces |",
        "|---|--:|--:|--:|---|---|---|--:|",
    );
    for (const r of sorted) {
        out.push(
            `| ${r.contribution ? "★ " : ""}${r.id} | ${ms(r.self)} | ${ms(r.inclusive)} | ${ms(r.start)} | ${r.window} | ` +
                `${r.requester} | ${r.phase ?? "—"} | ${String(r.runs)} |`,
        );
    }
    return out.join("\n");
}

function main(): void {
    const files: string[] = [];
    const opts = { sort: "self", top: 40, min: 0.3 };
    for (const arg of process.argv.slice(2)) {
        if (arg.startsWith("--sort=")) opts.sort = arg.slice("--sort=".length);
        else if (arg.startsWith("--top=")) opts.top = Number(arg.slice("--top=".length));
        else if (arg.startsWith("--min=")) opts.min = Number(arg.slice("--min=".length));
        else files.push(arg);
    }
    if (files.length === 0) throw new Error("expected DIODE_STARTUP_TRACE trace files");
    const traces: IStartupTrace[] = [];
    for (const file of files) {
        const trace = parseTrace(readFileSync(file, "utf8"));
        if (trace === null || !Array.isArray(trace.instantiations)) {
            console.error(`[services] skipped ${file}: not a trace or has no instantiations`);
            continue;
        }
        traces.push(trace);
    }
    console.log(renderTables(aggregate(traces), traces.length, opts));
}

main();
