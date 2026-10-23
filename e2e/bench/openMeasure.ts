
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { basename, join } from "node:path";
import { performance } from "node:perf_hooks";

import { packRgb } from "@tuidom/core/common/colorUtils";

import { AnsiScreen } from "../helpers/AnsiScreen.ts";
import { prepareAppEnv } from "../helpers/appSession.ts";
import { findNode } from "../helpers/inspectorClient.ts";
import { DiodeSession } from "../helpers/runDiode.ts";

import type { OpenFixture } from "./openFixtures.ts";
import { TS_MARKER } from "./openFixtures.ts";
import { startRssSampler } from "./rssSampler.ts";
import { type Ladder, ladderFromTrace, parseTrace } from "./startupLadder.ts";

export const COLS = 120;
export const ROWS = 32;


const KEYWORD_FG = packRgb(0x56, 0x9c, 0xd6);

export function contentVisible(screen: AnsiScreen, marker: string): boolean {
    return screen.findText(marker) !== null;
}

export function highlightVisible(screen: AnsiScreen): boolean {
    const pos = screen.findText(`const ${TS_MARKER}`);
    if (pos === null) return false;
    return screen.cellAt(pos.x, pos.y).fg === KEYWORD_FG;
}


export interface Chunk {
    /** ms since spawn. */
    readonly t: number;
    readonly data: string;
}

function renderPrefix(chunks: readonly Chunk[], upTo: number, cols: number, rows: number): AnsiScreen {
    // Always replay from scratch: AnsiScreen does not survive an escape sequence split
    // by a chunk boundary (a partially parsed ESC is silently dropped).
    const screen = new AnsiScreen(cols, rows);
    let joined = "";
    for (let i = 0; i <= upTo; i++) joined += chunks[i].data;
    screen.feed(joined);
    return screen;
}

/**
 * Binary search over chunks `[from, to]`: the predicate is monotonic — once a change appears,
 * later frames in the range do not erase it.
 */
export function firstSatisfiedAt(
    chunks: readonly Chunk[],
    predicate: (screen: AnsiScreen) => boolean,
    range: { from: number; to: number } = { from: 0, to: chunks.length - 1 },
    size: { cols: number; rows: number } = { cols: COLS, rows: ROWS },
): number | null {
    if (chunks.length === 0 || range.to < range.from) return null;
    if (!predicate(renderPrefix(chunks, range.to, size.cols, size.rows))) return null;
    let lo = range.from;
    let hi = range.to;
    let found = hi;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (predicate(renderPrefix(chunks, mid, size.cols, size.rows))) {
            found = mid;
            hi = mid - 1;
        } else {
            lo = mid + 1;
        }
    }
    return chunks[found].t;
}


export type WorkloadStepKey = "insert" | "enter" | "undoEnter" | "undoInsert" | "save" | "ctrlEnd" | "search";

export const WORKLOAD_STEPS: readonly { key: WorkloadStepKey; label: string }[] = [
    { key: "insert", label: "insert char" },
    { key: "enter", label: "Enter" },
    { key: "undoEnter", label: "undo (Enter)" },
    { key: "undoInsert", label: "undo (char)" },
    { key: "save", label: "save" },
    { key: "ctrlEnd", label: "Ctrl+End" },
    { key: "search", label: "word search" },
];

export interface WorkloadStepResult {
    readonly key: WorkloadStepKey;
    /** ms from writing the key to the PTY to the frame where the change is visible; null — timed out. */
    readonly latencyMs: number | null;
    readonly outcome: "ok" | "timeout" | "skipped";
}

export interface OpenRunResult {
    readonly outcome: "ok" | "timeout" | "crash";
    /** ms from spawn to the first frame with the file's text. */
    readonly contentMs: number | null;
    /**
     * ms from spawn until the background work after open has settled (`quiet` option): the tokenizer has
     * reached the end of the file and the width sweep has measured every line. Null — not requested.
     */
    readonly quietMs: number | null;
    /** ms from spawn to a colored token; null for plaintext. */
    readonly highlightMs: number | null;
    readonly exitCode: number | null;
    /** Signal that killed the process (9 = SIGKILL, usually the OOM killer), or null. */
    readonly signal: number | null;
    /** Peak RSS of the editor process during the run, in bytes (null — not Linux). */
    readonly peakRssBytes: number | null;
    /** Ladder of marks from the app trace (null — the trace never arrived). */
    readonly ladder: Ladder | null;
    readonly workload: readonly WorkloadStepResult[];
    /**
     * Separate from opening: the file may open and the process still die on the first edit (V8 heap OOM).
     * `crash` — the process exited, `failed` — a step timed out waiting for the screen, `skipped` — not run.
     */
    readonly workloadOutcome: "ok" | "crash" | "failed" | "skipped";
    readonly workloadError: string | null;
    readonly warmup: boolean;
}

export interface OpenMeasureOptions {
    readonly binary: string;
    readonly fixture: OpenFixture;
    readonly timeoutMs: number;
    readonly warmup?: boolean;
    /**
     * The workload after opening. `true` (default) — the full one (edits, save, Ctrl+End, search);
     * `{ editCycles }` — only the edit keys (insert, Enter, undo, undo), repeated that many times
     * with a pause between the cycles — the perf gate's steady-state keystroke; `false` — none.
     */
    readonly workload?: boolean | { readonly editCycles: number };
    /**
     * Before the workload, wait until the background work after open has settled (tokenizer at the end
     * of the file, width sweep done) — read from the editor's inspector state, so the run starts the
     * TUIDom inspector (`--inspect-tui`; it listens before the file opens, a few ms on the startup
     * path). Without it the first keys after Go to Line measure the tokenizer's backlog, not the edit.
     */
    readonly quiet?: boolean;
    /** How long to wait for the trace (the extension host starts after the frame). */
    readonly traceWaitMs?: number;
    /** When set, the trace also records instantiated services (`DIODE_STARTUP_TRACE_INSTANTIATIONS=1`). */
    readonly keepTraceAs?: string;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits for a trace file with `complete: true`; null — timed out. */
async function waitForTrace(path: string, deadline: number): Promise<string | null> {
    while (performance.now() < deadline) {
        if (existsSync(path)) {
            const text = readFileSync(path, "utf8");
            const parsed = parseTrace(text);
            if (parsed?.complete === true) return text;
        }
        await sleep(25);
    }
    return null;
}


const KEY_CTRL_G = "\x07";
const KEY_CTRL_F = "\x06";
const KEY_CTRL_Z = "\x1a";
const KEY_CTRL_S = "\x13";
const KEY_ENTER = "\r";
const KEY_CTRL_END = "\x1b[1;5F";
/** Inserted character: absent from the fixtures, so it is on screen only after the edit. */
const INSERT_CHAR = "@";

function bracketedPaste(text: string): string {
    return `\x1b[200~${text}\x1b[201~`;
}

interface StepContext {
    readonly session: DiodeSession;
    readonly chunks: Chunk[];
    readonly t0: number;
    readonly timeoutMs: number;
}

/**
 * Latency is measured from writing the key to the timestamp of the chunk where the predicate holds. The
 * predicate must be false before the write — otherwise the step is invalid.
 */
async function measureStep(
    ctx: StepContext,
    key: WorkloadStepKey,
    input: string,
    predicate: (screen: AnsiScreen) => boolean,
): Promise<WorkloadStepResult> {
    if (predicate(ctx.session.parseScreen())) return { key, latencyMs: null, outcome: "skipped" };
    const from = ctx.chunks.length;
    const tWrite = performance.now() - ctx.t0;
    ctx.session.write(input);
    const deadline = performance.now() + ctx.timeoutMs;
    while (performance.now() < deadline) {
        const seen = ctx.chunks.length;
        if (seen > from && predicate(ctx.session.parseScreen())) {
            const at = firstSatisfiedAt(ctx.chunks, predicate, { from, to: seen - 1 });
            return { key, latencyMs: at === null ? null : at - tWrite, outcome: at === null ? "timeout" : "ok" };
        }
        if (ctx.session.isExited) break;
        await sleep(10);
    }
    return { key, latencyMs: null, outcome: "timeout" };
}

/** A document line on screen: a unique prefix, so truncation by width does not matter. */
function linePrefix(fixture: OpenFixture, index: number): string {
    return fixture.lineAt(index).slice(0, 70);
}

/**
 * Not measured. Unlike `session.waitFor`, notices process death immediately rather than on timeout
 * (on `log500m` that meant 300 s of waiting after an OOM).
 */
async function settle(ctx: StepContext, predicate: (screen: AnsiScreen) => boolean, stableMs = 150): Promise<void> {
    const deadline = performance.now() + ctx.timeoutMs;
    while (performance.now() < deadline) {
        if (ctx.session.isExited) throw new Error("editor process exited during the workload");
        if (predicate(ctx.session.parseScreen())) {
            const before = ctx.chunks.length;
            await sleep(stableMs);
            if (ctx.chunks.length === before) return;
            continue;
        }
        await sleep(25);
    }
    throw new Error(`workload: screen did not reach the expected state within ${String(ctx.timeoutMs)} ms`);
}

/** Setup (not measured): jump to the middle of the file via Go to Line; returns the screen prefix of that line. */
async function gotoMiddle(ctx: StepContext, fixture: OpenFixture): Promise<string> {
    const middle = Math.floor(fixture.lines / 2);
    ctx.session.write(KEY_CTRL_G);
    await settle(ctx, () => true);
    ctx.session.write(`${String(middle + 1)}${KEY_ENTER}`);
    await settle(ctx, (s) => s.findText(linePrefix(fixture, middle)) !== null);
    return linePrefix(fixture, middle);
}

/** Insert a char at the line start, Enter, undo the Enter, undo the char: the document text is back as it was. */
async function measureEditCycle(ctx: StepContext, middleLine: string): Promise<WorkloadStepResult[]> {
    const insertVisible = (s: AnsiScreen) => s.findText(INSERT_CHAR) !== null;
    // Enter after `@` at the line start: the line itself moves one row down, `@`
    // stays on its row. Compare row positions rather than "the rest of the row is
    // empty": there is also a scrollbar to the right of the text.
    const lineSplitBelowChar = (s: AnsiScreen) => {
        const at = s.findText(INSERT_CHAR);
        const line = s.findText(middleLine);
        return at !== null && line !== null && line.y === at.y + 1;
    };
    const lineJoinedAfterChar = (s: AnsiScreen) => {
        const at = s.findText(INSERT_CHAR);
        const line = s.findText(middleLine);
        return at !== null && line !== null && line.y === at.y && line.x === at.x + 1;
    };
    return [
        await measureStep(ctx, "insert", INSERT_CHAR, insertVisible),
        await measureStep(ctx, "enter", KEY_ENTER, lineSplitBelowChar),
        await measureStep(ctx, "undoEnter", KEY_CTRL_Z, lineJoinedAfterChar),
        await measureStep(ctx, "undoInsert", KEY_CTRL_Z, (s) => !insertVisible(s)),
    ];
}

async function runWorkload(ctx: StepContext, fixture: OpenFixture): Promise<WorkloadStepResult[]> {
    const middleLine = await gotoMiddle(ctx, fixture);
    const results: WorkloadStepResult[] = await measureEditCycle(ctx, middleLine);
    // After two undos the text matches the disk, but the document is dirty (the
    // version moved forward): saving writes the same content — the fixture stays intact.
    // The visible result is the tab marker changing from `●` to `×`.
    const cleanTab = `${basename(fixture.path)} ×`;
    results.push(await measureStep(ctx, "save", KEY_CTRL_S, (s) => s.findText(cleanTab) !== null));
    results.push(
        await measureStep(
            ctx,
            "ctrlEnd",
            KEY_CTRL_END,
            (s) => s.findText(linePrefix(fixture, fixture.lines - 1)) !== null,
        ),
    );

    // Search: open the widget beforehand (not measured) and measure a single word search —
    // the word arrives as one paste event, not char by char (otherwise the metric would be
    // N incremental searches, one per letter).
    ctx.session.write(KEY_CTRL_F);
    await settle(ctx, () => true);
    results.push(
        await measureStep(ctx, "search", bracketedPaste(fixture.marker), (s) => s.findText("1 of 1") !== null),
    );
    return results;
}

/**
 * The pause before each edit cycle: no output for this long. Covers the work an edit schedules after
 * itself (folding recompute — `FeatureDebounce` 200–300 ms, occurrence highlight), so a cycle measures
 * the keystroke itself, not the tail of the previous one.
 */
const EDIT_CYCLE_PAUSE_MS = 500;

/** The gate's workload: the edit keys only, `cycles` times, each cycle after a pause. */
async function runEditCycles(ctx: StepContext, fixture: OpenFixture, cycles: number): Promise<WorkloadStepResult[]> {
    const middleLine = await gotoMiddle(ctx, fixture);
    const results: WorkloadStepResult[] = [];
    for (let i = 0; i < cycles; i++) {
        await settle(ctx, () => true, EDIT_CYCLE_PAUSE_MS);
        results.push(...(await measureEditCycle(ctx, middleLine)));
    }
    return results;
}

/** The editor's background work, as `EditorElement.inspectState()` reports it; null — no editor in the tree yet. */
async function editorBackgroundState(
    session: DiodeSession,
): Promise<{ tokenizationComplete: boolean; contentWidthFinal: boolean } | null> {
    const { root } = await session.getDocument();
    const state = findNode(root, (n) => n.type === "EditorElement")?.state;
    if (state === undefined) return null;
    return {
        tokenizationComplete: state.tokenizationComplete === true,
        contentWidthFinal: state.contentWidthFinal === true,
    };
}

/** Polls the inspector until the background work has settled; ms since `t0`, or null on timeout. */
async function waitForQuiet(session: DiodeSession, t0: number, deadline: number): Promise<number | null> {
    while (performance.now() < deadline) {
        if (session.isExited) return null;
        const state = await editorBackgroundState(session);
        if (state !== null && state.tokenizationComplete && state.contentWidthFinal) return performance.now() - t0;
        await sleep(50);
    }
    return null;
}

export async function measureOpenOnce(options: OpenMeasureOptions): Promise<OpenRunResult> {
    const { binary, fixture, timeoutMs } = options;
    const warmup = options.warmup ?? false;
    const root = mkdtempSync(join(os.tmpdir(), "diode-bench-run-"));
    const tracePath = join(root, "startup-trace.json");
    // Record DI instantiations only when the trace is kept (`--keep-traces`):
    // it is not free and would skew the numbers of a regular run.
    const traceEnv: Record<string, string> = { DIODE_STARTUP_TRACE: tracePath };
    if (options.keepTraceAs !== undefined) traceEnv.DIODE_STARTUP_TRACE_INSTANTIATIONS = "1";
    const env = await prepareAppEnv({ root, open: [fixture.path], env: traceEnv });
    const chunks: Chunk[] = [];
    const done = (screen: AnsiScreen) =>
        contentVisible(screen, fixture.marker) && (fixture.kind !== "ts" || highlightVisible(screen));

    const t0 = performance.now();
    const spawnEpoch = performance.timeOrigin + t0;
    const session = await DiodeSession.start({
        args: env.args,
        cwd: env.workspaceDir,
        env: env.env,
        binary,
        cols: COLS,
        rows: ROWS,
        inspect: options.quiet === true,
        onData: (data) => chunks.push({ t: performance.now() - t0, data }),
    });
    const rss = startRssSampler(session.pid);

    let outcome: OpenRunResult["outcome"] = "timeout";
    let exitCode: number | null = null;
    let signal: number | null = null;
    // Snapshot at detection time: workload and shutdown chunks arrive afterwards (screen
    // reset, leaving the alt screen), and replaying the whole buffer would see an
    // already changed screen.
    let measuredChunks = 0;
    let ladder: Ladder | null = null;
    let quietMs: number | null = null;
    let workload: WorkloadStepResult[] = [];
    let workloadOutcome: OpenRunResult["workloadOutcome"] = "skipped";
    let workloadError: string | null = null;
    let peakRssBytes: number | null = null;
    try {
        const deadline = t0 + timeoutMs;
        while (performance.now() < deadline) {
            const seen = chunks.length;
            if (done(session.parseScreen())) {
                outcome = "ok";
                measuredChunks = seen;
                break;
            }
            if (session.isExited) {
                outcome = "crash";
                break;
            }
            await sleep(25);
        }
        exitCode = session.code;
        signal = session.exitSignal;

        if (outcome === "ok") {
            // Tail of startup (extension host) — wait for the trace so the workload
            // is not measured on top of the subprocess spawn.
            const traceText = await waitForTrace(tracePath, performance.now() + (options.traceWaitMs ?? 15_000));
            const trace = traceText === null ? null : parseTrace(traceText);
            if (traceText !== null && options.keepTraceAs !== undefined) writeFileSync(options.keepTraceAs, traceText);
            ladder = trace === null ? null : ladderFromTrace(trace, spawnEpoch);
            if (options.quiet === true) {
                // Bounded by the run's timeout, like the workload steps: a tokenizer that never finishes
                // is a finding, not a hang.
                quietMs = await waitForQuiet(session, t0, t0 + timeoutMs);
                if (quietMs === null) {
                    workloadOutcome = "failed";
                    workloadError = `background work did not settle within ${String(timeoutMs)} ms`;
                }
            }
            if (options.workload !== false && workloadOutcome !== "failed") {
                // Process death on an edit is a workload result, not a bench failure:
                // opening is already measured, the remaining sizes must still run.
                try {
                    const ctx = { session, chunks, t0, timeoutMs };
                    workload =
                        typeof options.workload === "object"
                            ? await runEditCycles(ctx, fixture, options.workload.editCycles)
                            : await runWorkload(ctx, fixture);
                    workloadOutcome = workload.every((w) => w.outcome === "ok") ? "ok" : "failed";
                } catch (error: unknown) {
                    workloadOutcome = session.isExited ? "crash" : "failed";
                    workloadError = error instanceof Error ? error.message.split("\n")[0] : String(error);
                    exitCode = session.code;
                    signal = session.exitSignal;
                }
            }
        }
    } finally {
        peakRssBytes = rss.stop();
        await session.dispose();
        env.dispose();
    }

    if (outcome !== "ok") {
        return {
            outcome,
            contentMs: null,
            quietMs: null,
            highlightMs: null,
            exitCode,
            signal,
            peakRssBytes,
            ladder: null,
            workload: [],
            workloadOutcome: "skipped",
            workloadError: null,
            warmup,
        };
    }
    const range = { from: 0, to: measuredChunks - 1 };
    return {
        outcome: "ok",
        contentMs: firstSatisfiedAt(chunks, (s) => contentVisible(s, fixture.marker), range),
        quietMs,
        highlightMs: fixture.kind === "ts" ? firstSatisfiedAt(chunks, highlightVisible, range) : null,
        exitCode,
        signal,
        peakRssBytes,
        ladder,
        workload,
        workloadOutcome,
        workloadError,
        warmup,
    };
}
