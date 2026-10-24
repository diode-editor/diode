/**
 * Follow latency of the document on disk (docs/TODO/OpenPerformance.md, stage 4.4): from a line appended to the
 * file to the terminal frame that shows it, with the cursor on the last line. Black box: the SEA binary in a PTY,
 * the frame is the chunk whose replayed screen contains the line (as `bench:open` reads its ladder). Plus the
 * editor's CPU while following an idle file and a file written at a steady rate.
 *
 *   npm run bench:follow -- [--size=log500m] [--appends=30] [--gap-ms=400] [--idle-s=10] [--rate-lps=20] [--rate-s=10]
 *
 * Numbers go to the PR of the stage; the gate is 4.6.
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

import { prepareAppEnv } from "../helpers/appSession.ts";
import { getBinaryPath } from "../helpers/buildOnce.ts";
import { DiodeSession } from "../helpers/runDiode.ts";

import { generateFixture, OPT_IN_SIZES, SIZES } from "./openFixtures.ts";
import { type Chunk, COLS, contentVisible, firstSatisfiedAt, ROWS } from "./openMeasure.ts";
import { median, quantile } from "./stats.ts";

interface CliOptions {
    readonly size: string;
    readonly appends: number;
    readonly gapMs: number;
    readonly idleSeconds: number;
    readonly rateLinesPerSecond: number;
    readonly rateSeconds: number;
}

export function parseCli(argv: readonly string[]): CliOptions {
    const options = {
        size: "log500m",
        appends: 30,
        gapMs: 400,
        idleSeconds: 10,
        rateLinesPerSecond: 20,
        rateSeconds: 10,
    };
    for (const arg of argv) {
        const [key, value] = arg.split("=", 2);
        if (value === undefined) throw new Error(`expected --key=value, got ${arg}`);
        switch (key) {
            case "--size":
                options.size = value;
                break;
            case "--appends":
                options.appends = Number(value);
                break;
            case "--gap-ms":
                options.gapMs = Number(value);
                break;
            case "--idle-s":
                options.idleSeconds = Number(value);
                break;
            case "--rate-lps":
                options.rateLinesPerSecond = Number(value);
                break;
            case "--rate-s":
                options.rateSeconds = Number(value);
                break;
            default:
                throw new Error(`unknown option ${key}`);
        }
    }
    return options;
}

const CTRL_END = "\x1b[1;5F";

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** utime + stime of the process in seconds, from `/proc/<pid>/stat`; null off Linux. */
function cpuSeconds(pid: number): number | null {
    if (process.platform !== "linux") return null;
    let stat: string;
    try {
        stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    } catch {
        return null;
    }
    // The command name may hold spaces: the fields start after the closing parenthesis.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    // utime is field 14 and stime 15 of the whole line; two fields (pid, comm) are cut off, so 11 and 12 here.
    return (Number(fields[11]) + Number(fields[12])) / 100;
}

/** Process CPU over the next `seconds`, in percent of one core; null off Linux. */
async function cpuPercentOver(pid: number, seconds: number, during: () => Promise<void>): Promise<number | null> {
    const before = cpuSeconds(pid);
    const started = performance.now();
    await during();
    const after = cpuSeconds(pid);
    if (before === null || after === null) return null;
    return ((after - before) / ((performance.now() - started) / 1000)) * 100;
}

async function waitFor(
    session: DiodeSession,
    predicate: (text: string) => boolean,
    timeoutMs: number,
    what: string,
): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
        if (predicate(session.parseScreen().toString())) return;
        await sleep(25);
    }
    throw new Error(`timed out waiting for ${what}\n${session.parseScreen().toString()}`);
}

function formatMs(value: number | null): string {
    return value === null ? "—" : `${value.toFixed(1)} ms`;
}

function formatPercent(value: number | null): string {
    return value === null ? "—" : `${value.toFixed(2)}%`;
}

async function main(): Promise<void> {
    const cli = parseCli(process.argv.slice(2));
    const spec = [...SIZES, ...OPT_IN_SIZES].find((candidate) => candidate.key === cli.size);
    if (spec === undefined || spec.kind !== "log") throw new Error(`--size must name a log fixture, got ${cli.size}`);
    const binary = await getBinaryPath();
    const fixtureDir = mkdtempSync(join(os.tmpdir(), "diode-bench-follow-"));
    const root = mkdtempSync(join(os.tmpdir(), "diode-bench-follow-run-"));
    try {
        console.error(`[bench] fixture ${spec.key}…`);
        const fixture = await generateFixture(fixtureDir, spec);
        const env = await prepareAppEnv({ root, open: [fixture.path] });
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
        try {
            await waitFor(session, (text) => text.includes(fixture.marker), spec.timeoutMs, "the first screen");
            // The Follow entry appears with the document on disk; the index is over when its progress is gone.
            await waitFor(
                session,
                (text) => text.includes("Follow: Off") && !text.includes("Indexing "),
                spec.timeoutMs,
                "the index to finish",
            );
            session.write(CTRL_END);
            await waitFor(session, (text) => text.includes("Follow: On"), 30_000, "Ctrl+End to turn follow on");
            await sleep(500);

            console.error(`[bench] ${String(cli.appends)} appends, ${String(cli.gapMs)} ms apart…`);
            const latencies: number[] = [];
            for (let i = 0; i < cli.appends; i++) {
                const marker = `follow-bench-line-${String(i).padStart(4, "0")}`;
                const from = chunks.length;
                const written = performance.now() - t0;
                // The marker leads the line: the large-file toast covers the right half of the text.
                appendFileSync(fixture.path, `${marker} 2026-01-02T00:00:00.000Z INFO appended by the bench\n`);
                await waitFor(session, (text) => text.includes(marker), 10_000, marker);
                // The arrival of the first chunk whose screen shows the line is the frame, not the poll above.
                const shown = firstSatisfiedAt(chunks, (screen) => contentVisible(screen, marker), {
                    from,
                    to: chunks.length - 1,
                });
                if (shown === null) throw new Error(`${marker} seen by the poll but not in the chunks`);
                latencies.push(shown - written);
                await sleep(cli.gapMs);
            }

            console.error(`[bench] idle for ${String(cli.idleSeconds)} s…`);
            const idleCpu = await cpuPercentOver(session.pid, cli.idleSeconds, () => sleep(cli.idleSeconds * 1000));

            console.error(`[bench] ${String(cli.rateLinesPerSecond)} lines/s for ${String(cli.rateSeconds)} s…`);
            const steadyCpu = await cpuPercentOver(session.pid, cli.rateSeconds, async () => {
                const total = cli.rateLinesPerSecond * cli.rateSeconds;
                const period = 1000 / cli.rateLinesPerSecond;
                for (let i = 0; i < total; i++) {
                    appendFileSync(
                        fixture.path,
                        `steady-line-${String(i)} 2026-01-02T00:00:01.000Z INFO appended by the bench\n`,
                    );
                    await sleep(period);
                }
            });
            await waitFor(
                session,
                (text) => text.includes(`steady-line-${String(cli.rateLinesPerSecond * cli.rateSeconds - 1)} `),
                10_000,
                "the last steady line",
            );

            const sorted = [...latencies].sort((a, b) => a - b);
            console.log(
                `## Follow latency — ${spec.key} (${String(fixture.lines)} lines), ${String(cli.appends)} appends`,
            );
            console.log("");
            console.log("| metric | value |");
            console.log("| --- | ---: |");
            console.log(`| latency median | ${formatMs(median(latencies))} |`);
            console.log(`| latency p90 | ${formatMs(quantile(latencies, 0.9))} |`);
            console.log(`| latency min / max | ${formatMs(sorted[0])} / ${formatMs(sorted[sorted.length - 1])} |`);
            console.log(`| CPU, idle follow (${String(cli.idleSeconds)} s) | ${formatPercent(idleCpu)} |`);
            console.log(
                `| CPU, ${String(cli.rateLinesPerSecond)} lines/s (${String(cli.rateSeconds)} s) | ${formatPercent(steadyCpu)} |`,
            );
            console.log("");
            console.log(`latencies (ms): ${latencies.map((value) => value.toFixed(0)).join(" ")}`);
        } finally {
            await session.dispose();
        }
    } finally {
        rmSync(fixtureDir, { recursive: true, force: true });
        rmSync(root, { recursive: true, force: true });
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
