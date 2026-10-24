import { appendFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import type { AnsiScreen } from "../helpers/AnsiScreen.ts";
import { prepareAppEnv } from "../helpers/appSession.ts";
import { DiodeSession } from "../helpers/runDiode.ts";

import type { OpenFixture } from "./openFixtures.ts";
import {
    type Chunk,
    COLS,
    contentVisible,
    firstSatisfiedAt,
    linePrefix,
    measureEditCycle,
    ROWS,
    type StepContext,
    type WorkloadStepResult,
} from "./openMeasure.ts";

// Steps of the giant-file gate (`hugeBudget.bench.ts`) after the document on disk has been indexed: follow, find,
// Enable Editing. Black box like `openMeasure.ts`: the SEA binary in a PTY, a latency runs from writing to the PTY
// (or to the file) to the arrival of the first chunk whose replayed screen shows the change.

const KEY_CTRL_END = "\x1b[1;5F";
const KEY_CTRL_F = "\x06";
const KEY_F6 = "\x1b[17~";
const KEY_ENTER = "\r";
const KEY_DOWN = "\x1b[B";

/** nf-cod-lock — the read-only tab marker (tuidom `editorTabItemElement.ts`). */
const LOCK = "";
/** Status bar entries of the document on disk (`largeFileIndexingStatus.ts`, `largeFileFollowStatus.ts`). */
const INDEXING = "Indexing ";
/** The indexing entry follows the first frame by a frame or two; later than this, something else ran first. */
const INDEXING_APPEAR_MS = 2000;
const INDEXING_PERCENT = /Indexing (\d+)%/;
const LOADING = /Loading \d+%/;
const FOLLOW_ON = "Follow: On";

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function bracketedPaste(text: string): string {
    return `\x1b[200~${text}\x1b[201~`;
}

/** A live editor on the indexed giant file; `dispose` kills it and removes its profile. */
interface IndexedSession extends StepContext {
    readonly fixture: OpenFixture;
    /** A chunk whose screen shows the index progress (set by `openIndexing`). */
    indexingChunk: number;
    dispose(): Promise<void>;
}

/** Unmeasured: polls the screen until the predicate holds; throws on timeout or process death. */
async function waitScreen(ctx: StepContext, predicate: (s: AnsiScreen) => boolean, what: string): Promise<void> {
    const deadline = performance.now() + ctx.timeoutMs;
    while (performance.now() < deadline) {
        if (ctx.session.isExited) throw new Error(`editor exited while waiting for ${what}`);
        if (predicate(ctx.session.parseScreen())) return;
        await sleep(20);
    }
    throw new Error(`timed out waiting for ${what}\n${ctx.session.parseScreen().toString()}`);
}

/** Unmeasured: no output for `ms`. */
async function quietFor(ctx: StepContext, ms: number): Promise<void> {
    const deadline = performance.now() + ctx.timeoutMs;
    while (performance.now() < deadline) {
        const before = ctx.chunks.length;
        await sleep(ms);
        if (ctx.chunks.length === before) return;
    }
    throw new Error(`the screen did not settle within ${String(ctx.timeoutMs)} ms`);
}

/**
 * ms from `write()` to the first chunk whose screen satisfies the predicate. The predicate must be false before
 * the write, otherwise the sample would measure nothing.
 */
async function measureChange(
    ctx: StepContext,
    write: () => void,
    predicate: (s: AnsiScreen) => boolean,
    what: string,
): Promise<number> {
    if (predicate(ctx.session.parseScreen())) throw new Error(`${what}: already on screen before the input`);
    const from = ctx.chunks.length;
    const written = performance.now() - ctx.t0;
    write();
    await waitScreen(ctx, predicate, what);
    const shown = firstSatisfiedAt(ctx.chunks, predicate, { from, to: ctx.chunks.length - 1 });
    if (shown === null) throw new Error(`${what}: seen by the poll but not in the chunks`);
    return shown - written;
}

/**
 * Opens the fixture and waits until the first screen is up and the index progress is on the status bar. The entry is
 * required: a 500 MB file never fits the first chunk, so an index that never shows means it is gone or synchronous.
 */
async function openIndexing(binary: string, fixture: OpenFixture, timeoutMs: number): Promise<IndexedSession> {
    const env = await prepareAppEnv({ open: [fixture.path] });
    const chunks: Chunk[] = [];
    const t0 = performance.now();
    const session = await DiodeSession.start({
        args: env.args,
        cwd: env.workspaceDir,
        env: env.env,
        binary,
        cols: COLS,
        rows: ROWS,
        onData: (data) => chunks.push({ t: performance.now() - t0, data }),
    });
    const indexed: IndexedSession = {
        session,
        chunks,
        t0,
        timeoutMs,
        fixture,
        indexingChunk: -1,
        async dispose() {
            await session.dispose();
            env.dispose();
        },
    };
    try {
        await waitScreen(indexed, (s) => contentVisible(s, fixture.marker) && s.findText(LOCK) !== null, "the text");
        const shown = performance.now();
        await waitScreen(indexed, (s) => s.findText(INDEXING) !== null, "the index progress");
        indexed.indexingChunk = chunks.length - 1;
        if (performance.now() - shown > INDEXING_APPEAR_MS) {
            throw new Error(
                `the index progress came ${String(Math.round(performance.now() - shown))} ms after the text`,
            );
        }
        return indexed;
    } catch (error: unknown) {
        await indexed.dispose();
        throw error;
    }
}

/** Opens the fixture and waits until the first screen is up and the line index is done. */
async function openIndexed(binary: string, fixture: OpenFixture, timeoutMs: number): Promise<IndexedSession> {
    const indexed = await openIndexing(binary, fixture, timeoutMs);
    try {
        await waitScreen(indexed, (s) => s.findText(INDEXING) === null, "the index to finish");
        return indexed;
    } catch (error: unknown) {
        await indexed.dispose();
        throw error;
    }
}

/** The percentage of `Indexing N%` on the screen, or null when the entry is not there. */
function indexingPercent(screen: AnsiScreen): number | null {
    const match = INDEXING_PERCENT.exec(screen.toString());
    return match === null ? null : Number(match[1]);
}

export interface IndexResult {
    /**
     * ms from the first frame with `Indexing` at `WALK_FROM_PERCENT`% or more to the first one at `WALK_TO_PERCENT`%
     * or more (or gone): the walk itself, without the startup work that shares the main thread with its first chunks.
     * Null when keys were pressed (they share the thread too).
     */
    readonly walkMs: number | null;
    /** ArrowDown sent while `Indexing N%` is on screen: ms until the status bar shows the next line. */
    readonly keyMs: readonly number[];
}

/** Percent window of the index walk timed by {@link measureIndex}. */
export const WALK_FROM_PERCENT = 10;
export const WALK_TO_PERCENT = 90;

/**
 * The line index of the document on disk (4.2) while it runs: either the walk's own time from the progress entry
 * (`keys: false`), or ArrowDown pressed while the entry is up (`keys: true`) — the editor must answer during the
 * index. A key counts when it was sent with the entry on screen, even if the answer comes after the index: a
 * frozen walk shows exactly as such a key.
 */
export async function measureIndex(
    binary: string,
    fixture: OpenFixture,
    options: { readonly timeoutMs: number; readonly keys: boolean; readonly gapMs: number },
): Promise<IndexResult> {
    const ctx = await openIndexing(binary, fixture, options.timeoutMs);
    try {
        const keyMs: number[] = [];
        let line = 1;
        while (options.keys && ctx.session.parseScreen().findText(INDEXING) !== null) {
            const next = `Ln ${String(line + 1)},`;
            keyMs.push(
                await measureChange(
                    ctx,
                    () => ctx.session.write(KEY_DOWN),
                    (s) => s.findText(next) !== null,
                    `ArrowDown to line ${String(line + 1)}`,
                ),
            );
            line++;
            await sleep(options.gapMs);
        }
        await waitScreen(ctx, (s) => s.findText(INDEXING) === null, "the index to finish");
        if (options.keys) return { walkMs: null, keyMs };

        // Up to the chunk seen with the entry nothing hides it, so "the entry is up" is monotonic there; from its
        // first frame on, "at N% or gone" is monotonic to the end.
        const visible = (s: AnsiScreen): boolean => indexingPercent(s) !== null;
        const appeared = firstSatisfiedAt(ctx.chunks, visible, { from: 0, to: ctx.indexingChunk });
        const first = ctx.chunks.findIndex((c) => c.t === appeared);
        if (first < 0) throw new Error("the index progress is not in the chunks");
        const range = { from: first, to: ctx.chunks.length - 1 };
        const atLeast = (percent: number) => (s: AnsiScreen) => (indexingPercent(s) ?? 100) >= percent;
        const start = firstSatisfiedAt(ctx.chunks, atLeast(WALK_FROM_PERCENT), range);
        const end = firstSatisfiedAt(ctx.chunks, atLeast(WALK_TO_PERCENT), range);
        if (start === null || end === null) throw new Error("the index progress did not reach its end in the chunks");
        return { walkMs: end - start, keyMs };
    } finally {
        await ctx.dispose();
    }
}

/**
 * Follow (OpenPerformance 4.4): `Ctrl+End` turns follow on, then each appended line is timed from the write to the
 * file to the frame that shows it. The appended lines stay in the fixture: they are past its last line and no
 * other step looks there.
 */
export async function measureFollow(
    binary: string,
    fixture: OpenFixture,
    options: { readonly timeoutMs: number; readonly appends: number; readonly gapMs: number },
): Promise<number[]> {
    const ctx = await openIndexed(binary, fixture, options.timeoutMs);
    try {
        ctx.session.write(KEY_CTRL_END);
        await waitScreen(ctx, (s) => s.findText(FOLLOW_ON) !== null, "Ctrl+End to turn follow on");
        await quietFor(ctx, 300);
        const latencies: number[] = [];
        for (let i = 0; i < options.appends; i++) {
            // The marker leads the line: the large-file toast covers the right half of the text.
            const marker = `gate-follow-${String(performance.now() | 0)}-${String(i)}`;
            latencies.push(
                await measureChange(
                    ctx,
                    () => appendFileSync(fixture.path, `${marker} INFO appended by the perf gate\n`),
                    (s) => s.findText(marker) !== null,
                    `appended line ${marker}`,
                ),
            );
            await sleep(options.gapMs);
        }
        return latencies;
    } finally {
        await ctx.dispose();
    }
}

export interface FindResult {
    /** ms from pasting a query whose only match is in the middle of the file to the counter showing it. */
    readonly firstMatchMs: number;
    /** Each typed character of the next queries: ms until the query row shows it, each while a walk is running. */
    readonly keyMs: readonly number[];
    /** How many of `keyMs` went in while the counter still had its "…" (a walk in progress). */
    readonly keysDuringWalk: number;
}

/**
 * Find (OpenPerformance 4.3) on the read-only document: the walk starts at the cursor (line 1), so the first match
 * in the middle of the file costs half a walk. Then each typed character starts a new walk over the whole file, and
 * the next one is timed while it runs: a key must not wait for the walk.
 */
export async function measureFind(
    binary: string,
    fixture: OpenFixture,
    options: { readonly timeoutMs: number; readonly typed: string; readonly gapMs: number },
): Promise<FindResult> {
    const ctx = await openIndexed(binary, fixture, options.timeoutMs);
    try {
        // `request <n> handled …`: "<n> " with the trailing space is on that line only, and short enough for the
        // widget's input (44 columns with the counter and the buttons).
        const middle = Math.floor(fixture.lines / 2);
        const query = `${String(middle)} `;
        if (!fixture.lineAt(middle).includes(`${query}${options.typed}`)) {
            throw new Error(`line ${String(middle)} does not continue the query with "${options.typed}"`);
        }
        ctx.session.write(KEY_CTRL_F);
        await quietFor(ctx, 300);
        const firstMatchMs = await measureChange(
            ctx,
            () => ctx.session.write(bracketedPaste(query)),
            (s) => s.findText("1 of 1") !== null,
            "the first match",
        );
        // The query is checked on the widget's row, taken from the counter once: while a walk has no match yet the
        // counter is "Searching…", and the editor reveals the matched line, which holds the query as well.
        const widgetRow = ctx.session.parseScreen().findText("1 of 1")?.y;
        if (widgetRow === undefined) throw new Error("the find counter left the screen");
        const queryRowShows = (s: AnsiScreen, text: string): boolean => s.lineText(widgetRow).includes(text);
        const keyMs: number[] = [];
        let keysDuringWalk = 0;
        let typed = query;
        for (const ch of options.typed) {
            if (ctx.session.parseScreen().findText("…") !== null) keysDuringWalk++;
            typed += ch;
            const expected = typed;
            keyMs.push(
                await measureChange(
                    ctx,
                    () => ctx.session.write(ch),
                    (s) => queryRowShows(s, expected),
                    `typed "${ch}"`,
                ),
            );
            await sleep(options.gapMs);
        }
        return { firstMatchMs, keyMs, keysDuringWalk };
    } finally {
        await ctx.dispose();
    }
}

export interface EnableEditingResult {
    /** ms from pressing the toast's Enable Editing to the frame where the tab is editable. */
    readonly editableMs: number;
    /** ArrowDown while the file streams into memory: ms until the status bar shows the next line. */
    readonly loadKeyMs: readonly number[];
    /** The edit keys right after the switch, while the restored features (tokenization, folding) catch up. */
    readonly editKeys: readonly WorkloadStepResult[];
}

/**
 * Enable Editing (OpenPerformance 4.5): F6 focuses the large-file toast, Enter presses its button. While `Loading
 * N%` is up, ArrowDown is timed through the status bar's `Ln`; once the tab is editable, edit cycles (insert, Enter,
 * undo, undo) on the cursor's line follow at once, without waiting for the background work.
 */
export async function measureEnableEditing(
    binary: string,
    fixture: OpenFixture,
    options: { readonly timeoutMs: number; readonly editCycles: number; readonly gapMs: number },
): Promise<EnableEditingResult> {
    const ctx = await openIndexed(binary, fixture, options.timeoutMs);
    try {
        await waitScreen(ctx, (s) => s.findText("Enable Editing") !== null, "the large-file toast");
        ctx.session.write(KEY_F6);
        await quietFor(ctx, 300);
        const editable = (s: AnsiScreen): boolean => s.findText(LOCK) === null && !LOADING.test(s.toString());
        const from = ctx.chunks.length;
        const pressed = performance.now() - ctx.t0;
        ctx.session.write(KEY_ENTER);
        await waitScreen(ctx, (s) => LOADING.test(s.toString()) || editable(s), "the load to start");

        const loadKeyMs: number[] = [];
        let line = 1;
        while (LOADING.test(ctx.session.parseScreen().toString())) {
            const next = `Ln ${String(line + 1)},`;
            const ms = await measureChange(
                ctx,
                () => ctx.session.write(KEY_DOWN),
                (s) => s.findText(next) !== null,
                `ArrowDown to line ${String(line + 1)}`,
            );
            line++;
            // A key answered by the switch's own frame measures the end of the load, not a key during it.
            if (LOADING.test(ctx.session.parseScreen().toString())) loadKeyMs.push(ms);
            await sleep(options.gapMs);
        }
        await waitScreen(ctx, editable, "the tab to become editable");
        const shown = firstSatisfiedAt(ctx.chunks, editable, { from, to: ctx.chunks.length - 1 });
        if (shown === null) throw new Error("editable seen by the poll but not in the chunks");

        const lineOnScreen = linePrefix(fixture, line - 1);
        const editKeys: WorkloadStepResult[] = [];
        for (let i = 0; i < options.editCycles; i++) {
            editKeys.push(...(await measureEditCycle(ctx, lineOnScreen)));
            await sleep(options.gapMs);
        }
        return { editableMs: shown - pressed, loadKeyMs, editKeys };
    } finally {
        await ctx.dispose();
    }
}
