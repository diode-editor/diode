import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import type { AnsiScreen } from "../helpers/AnsiScreen.ts";
import { prepareAppEnv, removeTempDir } from "../helpers/appSession.ts";
import { getBinaryPath } from "../helpers/buildOnce.ts";
import { DiodeSession } from "../helpers/runDiode.ts";

import { generateFixture, SIZES } from "./openFixtures.ts";
import { COLS, contentVisible, ROWS } from "./openMeasure.ts";

// Does the giant-file gate (`hugeBudget.bench.ts`) catch a regression? Each entry below plants one regression
// into the product source, runs `npm run test:perf:huge`, restores the source and checks the verdict: the gate must
// go red. It also checks that the run leaves no fixture behind in the temp directory (500 MB each). Exit code 1
// when the gate passed a regression or leaked its fixture. Heavy (one gate run per regression, a binary build
// each): run under the lease.
//
//   claude-lease run -r машина -- npx tsx e2e/bench/hugeGateRegressions.ts [name ...]
//
// `--probe` (with a regression planted by hand) only measures an ArrowDown sent while "Indexing N%" is on screen:
// the frozen UI that the three budgets do not see.

interface Regression {
    readonly name: string;
    readonly what: string;
    readonly file: string;
    readonly find: string;
    readonly replace: string;
    /** Also run the key probe while this regression is planted. */
    readonly probe?: boolean;
}

const DISK_BUFFER = "src/vs/editor/common/model/diskTextBuffer.ts";
const FILE_MODEL = "src/vs/workbench/services/textfile/common/textFileModel.ts";

const REGRESSIONS: readonly Regression[] = [
    {
        name: "in-memory",
        what: "a file above the threshold is read into memory again (loadDocumentFromDisk)",
        file: FILE_MODEL,
        find: "        if (opener === null) return false;\n        const languageId",
        replace: "        if (opener !== undefined) return false;\n        const languageId",
    },
    {
        name: "sync-before-frame",
        what: "a synchronous pass over the whole file before the first frame",
        file: DISK_BUFFER,
        find: "        if (this.indexedBytes >= file.size) this.finish();\n    }\n",
        replace: [
            "        if (this.indexedBytes >= file.size) this.finish();",
            "        let feeds = 0;",
            "        for (let offset = read; offset < file.size; offset += this.chunkSize) {",
            "            const n = file.readSync(chunk, offset);",
            "            for (let i = 0; i < n; i++) if (chunk[i] === 10) feeds++;",
            "        }",
            "        (globalThis as Record<string, unknown>).regressionFeeds = feeds;",
            "    }",
            "",
        ].join("\n"),
    },
    {
        name: "sync-after-frame",
        what: "the whole index built synchronously right after the first frame (the UI freezes for the index)",
        file: DISK_BUFFER,
        find: "        this.indexingStarted = true;\n        void this.indexRest();\n",
        replace: [
            "        this.indexingStarted = true;",
            "        setTimeout(() => {",
            "            const chunk = Buffer.allocUnsafe(this.chunkSize);",
            "            for (const offset of this.chunkOffsets()) {",
            "                const read = this.file.readSync(chunk, offset);",
            "                if (read <= 0) break;",
            "                this.indexChunk(chunk.subarray(0, read), offset);",
            "            }",
            "            this.finish();",
            "        }, 300);",
            "",
        ].join("\n"),
        probe: true,
    },
    {
        name: "index-2x",
        what: "the index walk does its work twice (each chunk read and scanned for line starts twice)",
        file: DISK_BUFFER,
        find: "                const read = await this.file.read(chunk, offset);\n",
        replace: [
            "                await this.file.read(chunk, offset);",
            "                new LineStartIndex().appendChunk(chunk, offset);",
            "                const read = await this.file.read(chunk, offset);",
            "",
        ].join("\n"),
    },
    {
        name: "index-2x-time",
        what: "the index walk takes twice the wall time (after each chunk it waits as long as the chunk took)",
        file: DISK_BUFFER,
        find: "                this.onDidChangeIndexingEmitter.fire();\n            }\n        } catch",
        replace: [
            "                this.onDidChangeIndexingEmitter.fire();",
            "                const self = this as unknown as { regressionLast?: number };",
            "                const spent = performance.now() - (self.regressionLast ?? performance.now());",
            "                await new Promise((resolve) => setTimeout(resolve, spent));",
            "                self.regressionLast = performance.now();",
            "            }",
            "        } catch",
        ].join("\n"),
    },
    {
        name: "copy-of-text",
        what: "an extra copy of the indexed bytes kept in memory (RSS +500 MB)",
        file: DISK_BUFFER,
        find: "        this.starts.appendChunk(chunk, offset);\n",
        replace: [
            "        this.starts.appendChunk(chunk, offset);",
            "        const copies = ((globalThis as Record<string, unknown>).regressionCopies ??= []) as Buffer[];",
            "        copies.push(Buffer.from(chunk));",
            "",
        ].join("\n"),
    },
];

const FIXTURE_PREFIX = "diode-perf-huge-";

function fixtureDirs(): Set<string> {
    return new Set(readdirSync(os.tmpdir()).filter((name) => name.startsWith(FIXTURE_PREFIX)));
}

interface GateRun {
    readonly red: boolean;
    readonly verdict: string;
    readonly leaked: readonly string[];
    /** Medians of the gate's samples: ms over the node floor, ms to the index, MiB of peak RSS. */
    readonly medians: Medians | null;
}

interface Medians {
    readonly text: number;
    readonly index: number;
    readonly rss: number;
}

/**
 * The gate is calibrated on the CI runner, and this machine may be slower (the clean run may already be red here).
 * So the verdict is the CI equivalent: the regression's median over the clean median on this machine, times the CI
 * median of the PR's run (40099005560, e2e ubuntu), against the budget. Budgets as in `hugeBudget.bench.ts`
 * (not imported: its top level writes the 500 MB fixture).
 */
const CI: Record<keyof Medians, { readonly median: number; readonly budget: number; readonly unit: string }> = {
    text: { median: 145, budget: 300, unit: "ms" },
    index: { median: 1078, budget: 1600, unit: "ms" },
    rss: { median: 293, budget: 420, unit: "MiB" },
};

function medianOf(values: readonly number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function parseMedians(verdict: string): Medians | null {
    const samples = (label: string): number[] | null => {
        const match = new RegExp(`${label} \\[([^\\]]*)\\]`).exec(verdict);
        return match === null ? null : match[1].split(", ").map(Number);
    };
    const text = samples("to text");
    const index = samples("index");
    const rss = samples("peak RSS");
    if (text === null || index === null || rss === null) return null;
    return { text: medianOf(text), index: medianOf(index), rss: medianOf(rss) };
}

/** The budgets the regression would break on CI, as `index 1610 > 1600 ms`; empty — it would pass. */
function overOnCi(clean: Medians, regression: Medians): string[] {
    return (Object.keys(CI) as (keyof Medians)[]).flatMap((key) => {
        const value = (regression[key] / clean[key]) * CI[key].median;
        return value > CI[key].budget
            ? [`${key} ${String(Math.round(value))} > ${String(CI[key].budget)} ${CI[key].unit}`]
            : [];
    });
}

function runGate(): GateRun {
    const before = fixtureDirs();
    const result = spawnSync("npm", ["run", "test:perf:huge"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const output = `${result.stdout}\n${result.stderr}`;
    const verdict =
        output.split("\n").find((line) => line.includes("over budget") || line.includes("[perf] log500m")) ??
        `no verdict line (exit ${String(result.status)})`;
    const leaked = [...fixtureDirs()].filter((name) => !before.has(name));
    // The gate's own leftover is not this harness's business to keep: the next run would see it as old.
    for (const name of leaked) removeTempDir(join(os.tmpdir(), name));
    return { red: result.status !== 0, verdict: verdict.trim(), leaked, medians: parseMedians(verdict) };
}

function runProbe(): number {
    const result = spawnSync("npx", ["tsx", "e2e/bench/hugeGateRegressions.ts", "--probe"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
    });
    const ms = Number(result.stdout.trim().split("\n").at(-1));
    if (result.status !== 0 || !Number.isFinite(ms)) throw new Error(`probe failed: ${result.stdout}`);
    return ms;
}

async function pollScreen(
    session: DiodeSession,
    predicate: (s: AnsiScreen) => boolean,
    timeoutMs: number,
): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    while (!predicate(session.parseScreen())) {
        if (session.isExited || performance.now() > deadline) throw new Error(session.parseScreen().toString());
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

/** ms from ArrowDown, sent 400 ms after the text while "Indexing N%" is still on screen, to `Ln 2` in the status bar. */
async function probeKeyDuringIndex(): Promise<number> {
    const spec = SIZES.find((s) => s.key === "log500m");
    if (spec === undefined) throw new Error("size matrix has no log500m");
    const binary = await getBinaryPath();
    const dir = mkdtempSync(join(os.tmpdir(), "diode-probe-huge-"));
    try {
        const fixture = await generateFixture(dir, spec);
        const env = await prepareAppEnv({ open: [fixture.path] });
        const session = await DiodeSession.start({
            args: env.args,
            cwd: env.workspaceDir,
            env: env.env,
            binary,
            cols: COLS,
            rows: ROWS,
        });
        try {
            // Not `waitFor`: it waits for a stable screen, and "Indexing N%" changes it until the index is done.
            await pollScreen(session, (s) => contentVisible(s, fixture.marker), spec.timeoutMs);
            await new Promise((resolve) => setTimeout(resolve, 400));
            if (session.parseScreen().findText("Indexing ") === null) throw new Error("the index is already done");
            const sent = performance.now();
            session.write("\x1b[B");
            await pollScreen(session, (s) => s.findText("Ln 2,") !== null, spec.timeoutMs);
            return performance.now() - sent;
        } finally {
            await session.dispose();
            env.dispose();
        }
    } finally {
        removeTempDir(dir);
    }
}

async function main(): Promise<number> {
    if (process.argv.includes("--probe")) {
        console.log(String(Math.round(await probeKeyDuringIndex())));
        return 0;
    }
    const only = process.argv.slice(2);
    const selected = only.length === 0 ? REGRESSIONS : REGRESSIONS.filter((r) => only.includes(r.name));
    let failures = 0;
    const clean = runGate();
    const cleanProbe = selected.some((r) => r.probe === true)
        ? `; ArrowDown during the index ${String(runProbe())} ms`
        : "";
    console.log(`clean: ${clean.red ? "RED" : "green"} — ${clean.verdict}${cleanProbe}`);
    if (clean.leaked.length > 0) {
        failures++;
        console.log(`clean: LEAKED the fixture ${clean.leaked.join(", ")} (removed by this harness)`);
    }
    for (const regression of selected) {
        const source = readFileSync(regression.file, "utf8");
        if (!source.includes(regression.find))
            throw new Error(`${regression.name}: anchor not found in ${regression.file}`);
        writeFileSync(regression.file, source.replace(regression.find, regression.replace));
        try {
            const run = runGate();
            const probe = regression.probe === true ? `; ArrowDown during the index ${String(runProbe())} ms` : "";
            const over = clean.medians !== null && run.medians !== null ? overOnCi(clean.medians, run.medians) : null;
            const caught = over === null ? run.red : over.length > 0;
            const onCi =
                over === null
                    ? "no samples to compare"
                    : over.length > 0
                      ? `on CI: ${over.join(", ")}`
                      : "on CI: within all budgets";
            console.log(
                `${regression.name}: ${caught ? "caught" : "MISSED"} (${regression.what}); here ${run.red ? "red" : "green"}, ${onCi} — ${run.verdict}${probe}`,
            );
            if (!caught) failures++;
        } finally {
            writeFileSync(regression.file, source);
        }
    }
    return failures === 0 ? 0 : 1;
}

process.exitCode = await main();
