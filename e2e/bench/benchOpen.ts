/**
 * Бенчмарк открытия файла: от спауна процесса до появления содержимого на
 * экране (time-to-content) и до раскраски токенов (time-to-highlight).
 *
 * Чёрный ящик: запускаем настоящий SEA-бинарь через PTY (тот же путь, что у
 * пользователя), таймстемпим каждый чанк stdout и постфактум находим первый
 * чанк, после которого предикат по экрану выполняется. Никакой инструментации
 * в приложении — только его видимый вывод.
 *
 * LSP в замер не входит: замер заканчивается на TextMate-подсветке, language
 * server приезжает асинхронно позже.
 *
 * Запуск: `npm run bench:open [-- --sizes=small,log500m --runs=3 --json=out.json --md=out.md]`
 * Бинарь собирается лениво (`getBinaryPath` → `npm run build:sea`), либо
 * передаётся готовый через env `DIODE_E2E_BINARY`.
 */

import { spawnSync } from "node:child_process";
import { createWriteStream, mkdtempSync, statSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { packRgb } from "@tuidom/core/common/colorUtils";

import { AnsiScreen } from "../helpers/AnsiScreen.ts";
import { prepareAppEnv, removeTempDir } from "../helpers/appSession.ts";
import { getBinaryPath } from "../helpers/buildOnce.ts";
import { DiodeSession } from "../helpers/runDiode.ts";

// ── Матрица размеров ─────────────────────────────────────────────────────────

interface SizeSpec {
    readonly key: string;
    readonly kind: "ts" | "log";
    /** Для kind=ts — число строк; для kind=log — целевой размер в байтах. */
    readonly amount: number;
    /** Замеряемых прогонов (плюс один прогревочный, в статистику не идёт). */
    readonly runs: number;
    readonly timeoutMs: number;
}

const MiB = 1024 * 1024;

const SIZES: readonly SizeSpec[] = [
    { key: "small", kind: "ts", amount: 100, runs: 11, timeoutMs: 30_000 },
    { key: "medium", kind: "ts", amount: 2_000, runs: 11, timeoutMs: 30_000 },
    { key: "large", kind: "ts", amount: 20_000, runs: 7, timeoutMs: 60_000 },
    { key: "xlarge", kind: "ts", amount: 200_000, runs: 5, timeoutMs: 120_000 },
    { key: "log500m", kind: "log", amount: 500 * MiB, runs: 3, timeoutMs: 180_000 },
];

// ── Предикаты по экрану ──────────────────────────────────────────────────────

// Первая строка ts-фикстуры: `const benchMarker = 42; // diode-bench`.
// Контент — маркер виден; подсветка — ячейка `c` слова `const` покрашена
// цветом keyword из darkPlus (дефолтная тема; тот же ассерт в sea-startup).
const TS_MARKER = "benchMarker";
const TS_FIRST_LINE = `const ${TS_MARKER} = 42; // diode-bench`;
const KEYWORD_FG = packRgb(0x56, 0x9c, 0xd6);
// Первая строка лога; `.log` — plaintext, подсветки не существует.
const LOG_MARKER = "diode-bench-log-start";

function contentVisible(screen: AnsiScreen, marker: string): boolean {
    return screen.findText(marker) !== null;
}

function highlightVisible(screen: AnsiScreen): boolean {
    const pos = screen.findText(`const ${TS_MARKER}`);
    if (pos === null) return false;
    return screen.cellAt(pos.x, pos.y).fg === KEYWORD_FG;
}

// ── Фикстуры ─────────────────────────────────────────────────────────────────

/** Пишет файл блоками через стрим — 500 МБ одной строкой не собрать. */
async function writeLines(path: string, lines: () => Generator<string>): Promise<void> {
    const stream = createWriteStream(path);
    let block: string[] = [];
    for (const line of lines()) {
        block.push(line);
        if (block.length >= 10_000) {
            const flushed = block.join("\n") + "\n";
            block = [];
            if (!stream.write(flushed)) {
                await new Promise((resolve) => stream.once("drain", resolve));
            }
        }
    }
    if (block.length > 0) stream.write(block.join("\n") + "\n");
    await new Promise<void>((resolve, reject) => {
        stream.end(() => resolve());
        stream.on("error", reject);
    });
}

async function generateFixture(dir: string, spec: SizeSpec): Promise<{ path: string; lines: number }> {
    if (spec.kind === "ts") {
        const path = join(dir, `${spec.key}.ts`);
        await writeLines(path, function* () {
            yield TS_FIRST_LINE;
            for (let i = 1; i < spec.amount; i++) {
                yield `export const value${String(i)} = ${String(i)}; // sample line with a comment tail`;
            }
        });
        return { path, lines: spec.amount };
    }
    const path = join(dir, `${spec.key}.log`);
    const template = (i: number) =>
        `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.${String(i % 1000).padStart(3, "0")}Z INFO worker[${String(i % 8)}] request ${String(i)} handled in ${String(i % 90)}ms path=/api/v1/items/${String(i)}`;
    const approxLine = template(1_234_567).length + 1;
    const lineCount = Math.ceil(spec.amount / approxLine);
    await writeLines(path, function* () {
        yield `2026-01-01T00:00:00.000Z INFO ${LOG_MARKER}`;
        for (let i = 1; i < lineCount; i++) yield template(i);
    });
    return { path, lines: lineCount };
}

// ── Один прогон ──────────────────────────────────────────────────────────────

interface RunResult {
    outcome: "ok" | "timeout" | "crash";
    /** мс от спауна до первого кадра с текстом файла. */
    contentMs: number | null;
    /** мс от спауна до раскрашенного токена; null для plaintext. */
    highlightMs: number | null;
    exitCode: number | null;
    /** Сигнал, убивший процесс (9 = SIGKILL, обычно OOM killer), или null. */
    signal: number | null;
    warmup: boolean;
}

interface Chunk {
    t: number;
    data: string;
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
 * Таймстемп первого чанка, после которого предикат выполняется. Бинарный поиск —
 * предикат монотонный: появившийся на экране текст последующие кадры не стирают.
 */
function firstSatisfiedAt(
    chunks: readonly Chunk[],
    cols: number,
    rows: number,
    predicate: (screen: AnsiScreen) => boolean,
): number | null {
    if (chunks.length === 0) return null;
    if (!predicate(renderPrefix(chunks, chunks.length - 1, cols, rows))) return null;
    let lo = 0;
    let hi = chunks.length - 1;
    let found = hi;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (predicate(renderPrefix(chunks, mid, cols, rows))) {
            found = mid;
            hi = mid - 1;
        } else {
            lo = mid + 1;
        }
    }
    return chunks[found].t;
}

const COLS = 120;
const ROWS = 32;

async function measureOnce(binary: string, fixturePath: string, spec: SizeSpec, warmup: boolean): Promise<RunResult> {
    const env = await prepareAppEnv({ open: [fixturePath] });
    const chunks: Chunk[] = [];
    const marker = spec.kind === "ts" ? TS_MARKER : LOG_MARKER;
    const done = (screen: AnsiScreen) =>
        contentVisible(screen, marker) && (spec.kind !== "ts" || highlightVisible(screen));

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

    let outcome: RunResult["outcome"] = "timeout";
    let exitCode: number | null = null;
    let signal: number | null = null;
    // Срез на момент детекта: во время гашения (Ctrl+C) приходят ещё чанки
    // (сброс экрана, выход из alt-screen), и реплей «всего» буфера видел бы
    // уже разобранный экран.
    let measuredChunks = 0;
    try {
        const deadline = t0 + spec.timeoutMs;
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
    } finally {
        await session.dispose();
        env.dispose();
    }

    if (outcome !== "ok") {
        return { outcome, contentMs: null, highlightMs: null, exitCode, signal, warmup };
    }
    const measured = chunks.slice(0, measuredChunks);
    return {
        outcome: "ok",
        contentMs: firstSatisfiedAt(measured, COLS, ROWS, (s) => contentVisible(s, marker)),
        highlightMs: spec.kind === "ts" ? firstSatisfiedAt(measured, COLS, ROWS, highlightVisible) : null,
        exitCode: null,
        signal: null,
        warmup,
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Пол: цена самого процесса ────────────────────────────────────────────────

/** Медианное время `<cmd> --version` — пол, ниже которого старт не опустится. */
function measureFloor(cmd: string, runs = 7): number {
    const times: number[] = [];
    for (let i = 0; i < runs + 1; i++) {
        const start = performance.now();
        const result = spawnSync(cmd, ["--version"], { stdio: "pipe", timeout: 30_000 });
        const elapsed = performance.now() - start;
        if (result.status !== 0) throw new Error(`${cmd} --version exited ${String(result.status)}`);
        if (i > 0) times.push(elapsed); // первый — прогрев FS-кеша
    }
    return quantile(times, 0.5);
}

// ── Статистика и отчёт ───────────────────────────────────────────────────────

function quantile(values: readonly number[], q: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const idx = (sorted.length - 1) * q;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

interface Stats {
    median: number;
    min: number;
    max: number;
}

function stats(values: readonly number[]): Stats | null {
    if (values.length === 0) return null;
    return { median: quantile(values, 0.5), min: Math.min(...values), max: Math.max(...values) };
}

interface SizeReport {
    key: string;
    kind: string;
    fixtureBytes: number;
    fixtureLines: number;
    runs: RunResult[];
    content: Stats | null;
    highlight: Stats | null;
}

function formatMs(value: number | null | undefined): string {
    return value === null || value === undefined ? "—" : `${String(Math.round(value))} мс`;
}

function formatBytes(bytes: number): string {
    if (bytes >= MiB) return `${(bytes / MiB).toFixed(bytes >= 100 * MiB ? 0 : 1)} МБ`;
    return `${(bytes / 1024).toFixed(1)} КБ`;
}

function renderMarkdown(report: FullReport): string {
    const lines: string[] = [];
    lines.push("# Бенчмарк открытия файла");
    lines.push("");
    lines.push(`- Снято: ${report.generatedAt}, коммит \`${report.commit}\`, diode ${report.binaryVersion}`);
    lines.push(`- Машина: ${report.env.cpu} (${String(report.env.cores)} cores, ${String(report.env.memGb)} GB), ${report.env.platform}`);
    lines.push(`- Пол процесса (\`diode --version\`, median): ${formatMs(report.floors.binaryMs)}; пол node: ${formatMs(report.floors.nodeMs)}`);
    lines.push("");
    lines.push("| файл | размер | строк | до текста (median) | до подсветки (median) | min…max (текст) | прогонов |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const size of report.sizes) {
        const measured = size.runs.filter((r) => !r.warmup);
        // Провалы считаем по всем прогонам, включая прогревочный: краш на
        // прогреве — это не шум, а сам результат («файл не открывается»).
        const failed = size.runs.filter((r) => r.outcome !== "ok");
        const outcomeNote =
            failed.length === 0
                ? ""
                : ` ${failed
                      .map((r) => (r.signal !== null ? `${r.outcome} (signal ${String(r.signal)})` : r.outcome))
                      .join(", ")}`;
        const cells = [
            `\`${size.key}\``,
            formatBytes(size.fixtureBytes),
            String(size.fixtureLines),
            formatMs(size.content?.median) + outcomeNote,
            size.kind === "log" ? "— (plaintext)" : formatMs(size.highlight?.median),
            size.content === null ? "—" : `${String(Math.round(size.content.min))}…${String(Math.round(size.content.max))}`,
            String(measured.length),
        ];
        lines.push(`| ${cells.join(" | ")} |`);
    }
    lines.push("");
    lines.push(
        "Методика: SEA-бинарь запускается в PTY (120×32) в герметичном окружении " +
            "(свой user-data-dir и HOME); отсчёт — от спауна процесса; момент появления " +
            "текста/подсветки восстанавливается по таймстемпам чанков stdout. " +
            "«До подсветки» — первый кадр, где ключевое слово раскрашено темой. " +
            "LSP в замер не входит. Первый прогон каждого размера — прогревочный, в статистике не участвует.",
    );
    lines.push("");
    return lines.join("\n");
}

interface FullReport {
    generatedAt: string;
    commit: string;
    binaryVersion: string;
    env: { cpu: string; cores: number; memGb: number; platform: string };
    floors: { binaryMs: number; nodeMs: number };
    sizes: SizeReport[];
}

// ── CLI ──────────────────────────────────────────────────────────────────────

interface CliOptions {
    sizes: readonly SizeSpec[];
    runsOverride: number | null;
    jsonPath: string | null;
    mdPath: string | null;
}

function parseCli(argv: readonly string[]): CliOptions {
    const options: CliOptions = { sizes: SIZES, runsOverride: null, jsonPath: null, mdPath: null };
    for (const arg of argv) {
        if (arg.startsWith("--sizes=")) {
            const keys = arg.slice("--sizes=".length).split(",");
            const picked = SIZES.filter((s) => keys.includes(s.key));
            if (picked.length !== keys.length) {
                const known = SIZES.map((s) => s.key).join(", ");
                throw new Error(`--sizes: неизвестный ключ среди "${keys.join(",")}" (известные: ${known})`);
            }
            options.sizes = picked;
        } else if (arg.startsWith("--runs=")) {
            options.runsOverride = Number(arg.slice("--runs=".length));
            if (!Number.isInteger(options.runsOverride) || options.runsOverride < 1) {
                throw new Error(`--runs: ожидается целое ≥ 1, получено "${arg}"`);
            }
        } else if (arg.startsWith("--json=")) {
            options.jsonPath = arg.slice("--json=".length);
        } else if (arg.startsWith("--md=")) {
            options.mdPath = arg.slice("--md=".length);
        } else {
            throw new Error(`неизвестный аргумент: ${arg}`);
        }
    }
    return options;
}

async function main(): Promise<void> {
    const cli = parseCli(process.argv.slice(2));
    const binary = await getBinaryPath();
    const versionRun = spawnSync(binary, ["--version"], { stdio: "pipe", encoding: "utf8" });
    const binaryVersion = (versionRun.stdout ?? "").trim();

    const commitRun = spawnSync("git", ["rev-parse", "--short", "HEAD"], { stdio: "pipe", encoding: "utf8" });
    const commit = process.env.GITHUB_SHA?.slice(0, 12) ?? (commitRun.stdout ?? "unknown").trim();

    console.error("[bench] пол процесса…");
    const floors = {
        binaryMs: measureFloor(binary),
        nodeMs: measureFloor(process.execPath),
    };

    const fixtureDir = mkdtempSync(join(os.tmpdir(), "diode-bench-"));
    const sizes: SizeReport[] = [];
    try {
        for (const spec of cli.sizes) {
            console.error(`[bench] фикстура ${spec.key}…`);
            const fixture = await generateFixture(fixtureDir, spec);
            const fixtureBytes = statSync(fixture.path).size;
            const runs = cli.runsOverride ?? spec.runs;

            const results: RunResult[] = [];
            for (let i = 0; i <= runs; i++) {
                const warmup = i === 0;
                const result = await measureOnce(binary, fixture.path, spec, warmup);
                results.push(result);
                console.error(
                    `[bench] ${spec.key} #${String(i)}${warmup ? " (warmup)" : ""}: ${result.outcome}` +
                        (result.outcome === "ok"
                            ? ` content=${formatMs(result.contentMs)} highlight=${formatMs(result.highlightMs)}`
                            : ` exit=${String(result.exitCode)} signal=${String(result.signal)}`),
                );
                // Смысла жечь оставшиеся прогоны нет: исход детерминированно плохой.
                if (result.outcome === "crash") break;
            }

            const measured = results.filter((r) => !r.warmup && r.outcome === "ok");
            sizes.push({
                key: spec.key,
                kind: spec.kind,
                fixtureBytes,
                fixtureLines: fixture.lines,
                runs: results,
                content: stats(measured.map((r) => r.contentMs).filter((v): v is number => v !== null)),
                highlight: stats(measured.map((r) => r.highlightMs).filter((v): v is number => v !== null)),
            });
        }
    } finally {
        removeTempDir(fixtureDir);
    }

    const report: FullReport = {
        generatedAt: new Date().toISOString(),
        commit,
        binaryVersion,
        env: {
            cpu: os.cpus()[0]?.model ?? "unknown",
            cores: os.cpus().length,
            memGb: Math.round(os.totalmem() / (1024 * MiB)),
            platform: `${os.platform()} ${os.release()}`,
        },
        floors,
        sizes,
    };

    const markdown = renderMarkdown(report);
    if (cli.jsonPath !== null) writeFileSync(cli.jsonPath, JSON.stringify(report, null, 2) + "\n");
    if (cli.mdPath !== null) writeFileSync(cli.mdPath, markdown);
    console.log(markdown);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
