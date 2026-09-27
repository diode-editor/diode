/**
 * Один прогон бенча открытия файла: SEA-бинарь в PTY, чёрный ящик (таймстемпы
 * чанков stdout → момент появления текста/подсветки), белый ящик (трасса вех
 * по `DIODE_STARTUP_TRACE`), нагрузка после открытия (латентность клавиш) и
 * пиковый RSS. Общий модуль для отчёта (`benchOpen.ts`) и перф-гейта
 * (`startupBudget.bench.ts`).
 */

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { packRgb } from "@tuidom/core/common/colorUtils";

import { AnsiScreen } from "../helpers/AnsiScreen.ts";
import { prepareAppEnv } from "../helpers/appSession.ts";
import { DiodeSession } from "../helpers/runDiode.ts";

import type { OpenFixture } from "./openFixtures.ts";
import { TS_MARKER } from "./openFixtures.ts";
import { startRssSampler } from "./rssSampler.ts";
import { type Ladder, ladderFromTrace, parseTrace } from "./startupLadder.ts";

export const COLS = 120;
export const ROWS = 32;

// ── Предикаты по экрану ──────────────────────────────────────────────────────

const KEYWORD_FG = packRgb(0x56, 0x9c, 0xd6);

export function contentVisible(screen: AnsiScreen, marker: string): boolean {
    return screen.findText(marker) !== null;
}

export function highlightVisible(screen: AnsiScreen): boolean {
    const pos = screen.findText(`const ${TS_MARKER}`);
    if (pos === null) return false;
    return screen.cellAt(pos.x, pos.y).fg === KEYWORD_FG;
}

// ── Реплей чанков ────────────────────────────────────────────────────────────

export interface Chunk {
    /** мс от спауна. */
    readonly t: number;
    readonly data: string;
}

function renderPrefix(chunks: readonly Chunk[], upTo: number, cols: number, rows: number): AnsiScreen {
    // Реплей всегда с нуля: AnsiScreen не переживает escape-последовательность,
    // разрезанную границей чанка (недоразобранный ESC молча выбрасывается).
    const screen = new AnsiScreen(cols, rows);
    let joined = "";
    for (let i = 0; i <= upTo; i++) joined += chunks[i].data;
    screen.feed(joined);
    return screen;
}

/**
 * Таймстемп первого чанка в `[from, to]`, после которого предикат выполняется.
 * Бинарный поиск — предикат монотонный на отрезке: появившееся на экране
 * изменение последующие кадры отрезка не стирают.
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

// ── Результат прогона ────────────────────────────────────────────────────────

export type WorkloadStepKey = "insert" | "enter" | "undoEnter" | "undoInsert" | "ctrlEnd" | "search";

export const WORKLOAD_STEPS: readonly { key: WorkloadStepKey; label: string }[] = [
    { key: "insert", label: "вставка символа" },
    { key: "enter", label: "Enter" },
    { key: "undoEnter", label: "undo (Enter)" },
    { key: "undoInsert", label: "undo (символ)" },
    { key: "ctrlEnd", label: "Ctrl+End" },
    { key: "search", label: "поиск по слову" },
];

export interface WorkloadStepResult {
    readonly key: WorkloadStepKey;
    /** мс от записи клавиши в PTY до кадра, где изменение видно; null — не дождались. */
    readonly latencyMs: number | null;
    readonly outcome: "ok" | "timeout" | "skipped";
}

export interface OpenRunResult {
    readonly outcome: "ok" | "timeout" | "crash";
    /** мс от спауна до первого кадра с текстом файла. */
    readonly contentMs: number | null;
    /** мс от спауна до раскрашенного токена; null для plaintext. */
    readonly highlightMs: number | null;
    readonly exitCode: number | null;
    /** Сигнал, убивший процесс (9 = SIGKILL, обычно OOM killer), или null. */
    readonly signal: number | null;
    /** Пиковый RSS процесса редактора за прогон, байты (null — не Linux). */
    readonly peakRssBytes: number | null;
    /** Лестница вех из трассы приложения (null — трасса не доехала). */
    readonly ladder: Ladder | null;
    readonly workload: readonly WorkloadStepResult[];
    readonly warmup: boolean;
}

export interface OpenMeasureOptions {
    readonly binary: string;
    readonly fixture: OpenFixture;
    readonly timeoutMs: number;
    readonly warmup?: boolean;
    /** Гонять ли нагрузку после открытия (правки, Ctrl+End, поиск). По умолчанию — да. */
    readonly workload?: boolean;
    /** Сколько ждать трассу (extension host поднимается после кадра). */
    readonly traceWaitMs?: number;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ждёт файл трассы с `complete: true`; null — не дождались. */
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

// ── Нагрузка после открытия ──────────────────────────────────────────────────

const KEY_CTRL_G = "\x07";
const KEY_CTRL_F = "\x06";
const KEY_CTRL_Z = "\x1a";
const KEY_ENTER = "\r";
const KEY_CTRL_END = "\x1b[1;5F";
/** Символ вставки: в фикстурах не встречается, на экране виден только после правки. */
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
 * Пишет клавишу в PTY и ждёт кадр, в котором предикат выполнился; латентность —
 * от записи до таймстемпа этого чанка (бинарный поиск по чанкам после записи).
 * Предикат обязан быть ложным до записи — иначе шаг считается невалидным.
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

/** Строка документа на экране: уникальный префикс, чтобы не зависеть от обрезки по ширине. */
function linePrefix(fixture: OpenFixture, index: number): string {
    return fixture.lineAt(index).slice(0, 70);
}

async function runWorkload(ctx: StepContext, fixture: OpenFixture): Promise<WorkloadStepResult[]> {
    const results: WorkloadStepResult[] = [];
    const middle = Math.floor(fixture.lines / 2);

    // Подготовка (не меряется): в середину файла через Go to Line.
    ctx.session.write(KEY_CTRL_G);
    await ctx.session.waitFor(() => true, { timeoutMs: ctx.timeoutMs, stableMs: 150 });
    ctx.session.write(`${String(middle + 1)}${KEY_ENTER}`);
    await ctx.session.waitFor((s) => s.findText(linePrefix(fixture, middle)) !== null, {
        timeoutMs: ctx.timeoutMs,
        stableMs: 150,
    });

    const middleLine = linePrefix(fixture, middle);
    const insertVisible = (s: AnsiScreen) => s.findText(INSERT_CHAR) !== null;
    // Enter после `@` в начале строки: сама строка уезжает на ряд ниже, `@`
    // остаётся на своём. Смотрим на взаимное положение рядов, а не на «хвост
    // ряда пуст»: справа от текста стоит ещё и скроллбар.
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

    results.push(await measureStep(ctx, "insert", INSERT_CHAR, insertVisible));
    results.push(await measureStep(ctx, "enter", KEY_ENTER, lineSplitBelowChar));
    results.push(await measureStep(ctx, "undoEnter", KEY_CTRL_Z, lineJoinedAfterChar));
    results.push(await measureStep(ctx, "undoInsert", KEY_CTRL_Z, (s) => !insertVisible(s)));
    results.push(
        await measureStep(
            ctx,
            "ctrlEnd",
            KEY_CTRL_END,
            (s) => s.findText(linePrefix(fixture, fixture.lines - 1)) !== null,
        ),
    );

    // Поиск: виджет открываем заранее (не меряется), меряем один поиск слова —
    // слово приходит одним paste-событием, а не посимвольно (иначе метрика —
    // N инкрементальных поисков, по одному на букву).
    ctx.session.write(KEY_CTRL_F);
    await ctx.session.waitFor(() => true, { timeoutMs: ctx.timeoutMs, stableMs: 150 });
    results.push(
        await measureStep(ctx, "search", bracketedPaste(fixture.marker), (s) => s.findText("1 of 1") !== null),
    );
    return results;
}

// ── Один прогон ──────────────────────────────────────────────────────────────

export async function measureOpenOnce(options: OpenMeasureOptions): Promise<OpenRunResult> {
    const { binary, fixture, timeoutMs } = options;
    const warmup = options.warmup ?? false;
    const root = mkdtempSync(join(os.tmpdir(), "diode-bench-run-"));
    const tracePath = join(root, "startup-trace.json");
    const env = await prepareAppEnv({ root, open: [fixture.path], env: { DIODE_STARTUP_TRACE: tracePath } });
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
        onData: (data) => chunks.push({ t: performance.now() - t0, data }),
    });
    const rss = startRssSampler(session.pid);

    let outcome: OpenRunResult["outcome"] = "timeout";
    let exitCode: number | null = null;
    let signal: number | null = null;
    // Срез на момент детекта: дальше приходят чанки нагрузки и гашения (сброс
    // экрана, выход из alt-screen), и реплей «всего» буфера видел бы уже
    // изменённый экран.
    let measuredChunks = 0;
    let ladder: Ladder | null = null;
    let workload: WorkloadStepResult[] = [];
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
            // Хвост старта (extension host) — дожидаемся трассы, чтобы нагрузка
            // не мерилась поверх спауна субпроцесса.
            const traceText = await waitForTrace(tracePath, performance.now() + (options.traceWaitMs ?? 15_000));
            const trace = traceText === null ? null : parseTrace(traceText);
            ladder = trace === null ? null : ladderFromTrace(trace, spawnEpoch);
            if (options.workload !== false) {
                workload = await runWorkload({ session, chunks, t0, timeoutMs }, fixture);
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
            highlightMs: null,
            exitCode,
            signal,
            peakRssBytes,
            ladder: null,
            workload: [],
            warmup,
        };
    }
    const range = { from: 0, to: measuredChunks - 1 };
    return {
        outcome: "ok",
        contentMs: firstSatisfiedAt(chunks, (s) => contentVisible(s, fixture.marker), range),
        highlightMs: fixture.kind === "ts" ? firstSatisfiedAt(chunks, highlightVisible, range) : null,
        exitCode: null,
        signal: null,
        peakRssBytes,
        ladder,
        workload,
        warmup,
    };
}
