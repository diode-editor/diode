
import { createWriteStream } from "node:fs";
import { join } from "node:path";

export interface SizeSpec {
    readonly key: string;
    readonly kind: "ts" | "log";
    /** For kind=ts — the number of lines; for kind=log — the target size in bytes. */
    readonly amount: number;
    /** Measured runs (plus one warm-up run that isn't counted in the stats). */
    readonly runs: number;
    readonly timeoutMs: number;
    /**
     * Above the large-file threshold (docs/arch/Editor.md): the file opens read-only on disk, so there is no
     * workload, and the run waits for the line index to finish (the status bar's "Indexing N%" goes away) so
     * that peak RSS covers the index.
     */
    readonly readOnly?: boolean;
}

export const MiB = 1024 * 1024;

export const SIZES: readonly SizeSpec[] = [
    { key: "small", kind: "ts", amount: 100, runs: 11, timeoutMs: 30_000 },
    { key: "medium", kind: "ts", amount: 2_000, runs: 11, timeoutMs: 30_000 },
    { key: "large", kind: "ts", amount: 20_000, runs: 7, timeoutMs: 60_000 },
    { key: "xlarge", kind: "ts", amount: 200_000, runs: 5, timeoutMs: 120_000 },
    // Back since the document on disk (OpenPerformance 4.2): before it `log500m` took 88 s to open and died
    // with a V8 heap OOM on the first edit (CI, 2026-09-27). Read-only: no workload (the gate is 4.6).
    { key: "log500m", kind: "log", amount: 500 * MiB, runs: 3, timeoutMs: 180_000, readOnly: true },
];

/**
 * Not in the default matrix (the CI bench and the public page): opt in with `--sizes=log50m,log2g`.
 * Above the large-file threshold (docs/TODO/OpenPerformance.md, stage 4) the file opens read-only on disk;
 * `log2g` needs 2 GB of free disk for the fixture.
 */
export const OPT_IN_SIZES: readonly SizeSpec[] = [
    { key: "log50m", kind: "log", amount: 50 * MiB, runs: 3, timeoutMs: 180_000, readOnly: true },
    { key: "log100m", kind: "log", amount: 100 * MiB, runs: 3, timeoutMs: 300_000, readOnly: true },
    { key: "log2g", kind: "log", amount: 2048 * MiB, runs: 3, timeoutMs: 600_000, readOnly: true },
];

// Highlighting is checked by the darkPlus keyword color on the `c` cell of the word `const` (as in sea-startup),
// so the line starts with it.
export const TS_MARKER = "benchMarker";
export const TS_FIRST_LINE = `const ${TS_MARKER} = 42; // diode-bench`;
// The first log line; `.log` is plaintext, there's no highlighting.
export const LOG_MARKER = "diode-bench-log-start";
export const LOG_FIRST_LINE = `2026-01-01T00:00:00.000Z INFO ${LOG_MARKER}`;

export interface OpenFixture {
    readonly key: string;
    readonly kind: "ts" | "log";
    readonly path: string;
    readonly lines: number;
    /** Marker word of the first line: the bench uses it to see the text on screen. */
    readonly marker: string;
    lineAt(index: number): string;
}

function tsLine(i: number): string {
    return i === 0
        ? TS_FIRST_LINE
        : `export const value${String(i)} = ${String(i)}; // sample line with a comment tail`;
}

function logLine(i: number): string {
    if (i === 0) return LOG_FIRST_LINE;
    return `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.${String(i % 1000).padStart(3, "0")}Z INFO worker[${String(i % 8)}] request ${String(i)} handled in ${String(i % 90)}ms path=/api/v1/items/${String(i)}`;
}

/** Writes the file in blocks via a stream — 500 MB can't be built as a single string. */
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

export async function generateFixture(dir: string, spec: SizeSpec): Promise<OpenFixture> {
    if (spec.kind === "ts") {
        const path = join(dir, `${spec.key}.ts`);
        await writeLines(path, function* () {
            for (let i = 0; i < spec.amount; i++) yield tsLine(i);
        });
        return { key: spec.key, kind: "ts", path, lines: spec.amount, marker: TS_MARKER, lineAt: tsLine };
    }
    const path = join(dir, `${spec.key}.log`);
    const approxLine = logLine(1_234_567).length + 1;
    const lineCount = Math.ceil(spec.amount / approxLine);
    await writeLines(path, function* () {
        for (let i = 0; i < lineCount; i++) yield logLine(i);
    });
    return { key: spec.key, kind: "log", path, lines: lineCount, marker: LOG_MARKER, lineAt: logLine };
}
