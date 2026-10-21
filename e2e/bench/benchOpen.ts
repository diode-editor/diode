/**
 * File-open benchmark (docs/TODO/OpenPerformance.md): the SEA binary over PTY (black box —
 * replay of stdout chunks) alongside the `DIODE_STARTUP_TRACE` mark trace (white box); a discrepancy
 * between them is a finding in itself. The headline number is relative to the node floor measured
 * via the same PTY path. LSP is not measured: it arrives after TextMate highlighting.
 *
 * Usage: `npm run bench:open [-- --sizes=small,xlarge --runs=3 --json=out.json --md=out.md --label="on AC, idle"]`
 * (`--keep-traces=<dir>` keeps traces for `npm run bench:services`). The binary comes from the
 * e2e build cache keyed by source hash, or `DIODE_E2E_BINARY`. Heavy run — take the lease.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { dirname, join } from "node:path";

import { removeTempDir } from "../helpers/appSession.ts";
import { getBinaryPath } from "../helpers/buildOnce.ts";

import { generateFixture, MiB, SIZES, type SizeSpec } from "./openFixtures.ts";
import { COLS, measureOpenOnce, type OpenRunResult, ROWS } from "./openMeasure.ts";
import { formatMs, type FullReport, renderMarkdown, type SizeReport, summarizeSize } from "./openReport.ts";
import { BINARY_FLOOR_ARGS, measureFloorPty, NODE_FLOOR_ARGS, NODE_VERSION_ARGS } from "./ptyFloor.ts";


interface CliOptions {
    sizes: readonly SizeSpec[];
    runsOverride: number | null;
    jsonPath: string | null;
    mdPath: string | null;
    /** Label for local run conditions (machine, power, background load). */
    label: string | null;
    workload: boolean;
    /** Directory for run traces (`<size>-<n>.json`). */
    traceDir: string | null;
}

export function parseCli(argv: readonly string[]): CliOptions {
    const options: CliOptions = {
        sizes: SIZES,
        runsOverride: null,
        jsonPath: null,
        mdPath: null,
        label: null,
        workload: true,
        traceDir: null,
    };
    for (const arg of argv) {
        if (arg.startsWith("--sizes=")) {
            const keys = arg.slice("--sizes=".length).split(",");
            const picked = SIZES.filter((s) => keys.includes(s.key));
            if (picked.length !== keys.length) {
                const known = SIZES.map((s) => s.key).join(", ");
                throw new Error(`--sizes: unknown key in "${keys.join(",")}" (known: ${known})`);
            }
            options.sizes = picked;
        } else if (arg.startsWith("--runs=")) {
            options.runsOverride = Number(arg.slice("--runs=".length));
            if (!Number.isInteger(options.runsOverride) || options.runsOverride < 1) {
                throw new Error(`--runs: expected an integer ≥ 1, got "${arg}"`);
            }
        } else if (arg.startsWith("--json=")) {
            options.jsonPath = arg.slice("--json=".length);
        } else if (arg.startsWith("--md=")) {
            options.mdPath = arg.slice("--md=".length);
        } else if (arg.startsWith("--label=")) {
            options.label = arg.slice("--label=".length);
        } else if (arg.startsWith("--keep-traces=")) {
            options.traceDir = arg.slice("--keep-traces=".length);
        } else if (arg === "--no-workload") {
            options.workload = false;
        } else {
            throw new Error(`unknown argument: ${arg}`);
        }
    }
    return options;
}

export function describeConditions(env: Readonly<Record<string, string | undefined>>, label: string | null): string {
    const ci = env.GITHUB_ACTIONS === "true" || env.CI === "true" || env.CI === "1";
    if (ci) return `CI, shared runner (GitHub Actions)${label === null ? "" : `; ${label}`}`;
    return `local run on a developer machine${label === null ? "" : `: ${label}`}`;
}

async function main(): Promise<void> {
    const cli = parseCli(process.argv.slice(2));
    const binary = await getBinaryPath();
    const versionRun = spawnSync(binary, ["--version"], { stdio: "pipe", encoding: "utf8" });
    const binaryVersion = (versionRun.stdout ?? "").trim();

    const commitRun = spawnSync("git", ["rev-parse", "--short", "HEAD"], { stdio: "pipe", encoding: "utf8" });
    const commit = process.env.GITHUB_SHA?.slice(0, 12) ?? (commitRun.stdout ?? "unknown").trim();

    console.error("[bench] process floor (PTY)…");
    const floorOptions = { cols: COLS, rows: ROWS, runs: 7 };
    const floors = {
        binary: await measureFloorPty(binary, BINARY_FLOOR_ARGS, floorOptions),
        node: await measureFloorPty(process.execPath, NODE_FLOOR_ARGS, floorOptions),
        nodeVersion: await measureFloorPty(process.execPath, NODE_VERSION_ARGS, floorOptions),
    };
    console.error(
        `[bench] floor node=${formatMs(floors.node.medianMs)} (node --version=${formatMs(floors.nodeVersion.medianMs)}) ` +
            `binary=${formatMs(floors.binary.medianMs)}`,
    );

    if (cli.traceDir !== null) mkdirSync(cli.traceDir, { recursive: true });
    const fixtureDir = mkdtempSync(join(os.tmpdir(), "diode-bench-"));
    const sizes: SizeReport[] = [];
    try {
        for (const spec of cli.sizes) {
            console.error(`[bench] fixture ${spec.key}…`);
            const fixture = await generateFixture(fixtureDir, spec);
            const fixtureBytes = statSync(fixture.path).size;
            const runs = cli.runsOverride ?? spec.runs;

            const results: OpenRunResult[] = [];
            for (let i = 0; i <= runs; i++) {
                const warmup = i === 0;
                const result = await measureOpenOnce({
                    binary,
                    fixture,
                    timeoutMs: spec.timeoutMs,
                    warmup,
                    workload: cli.workload,
                    keepTraceAs:
                        cli.traceDir === null || warmup
                            ? undefined
                            : join(cli.traceDir, `${spec.key}-${String(i)}.json`),
                });
                results.push(result);
                const keys =
                    result.workload.length === 0
                        ? result.workloadOutcome === "skipped"
                            ? ""
                            : ` workload=${result.workloadOutcome}${result.workloadError === null ? "" : ` (${result.workloadError})`}`
                        : ` keys=[${result.workload.map((w) => `${w.key}=${formatMs(w.latencyMs)}`).join(" ")}]` +
                          (result.workloadOutcome === "ok" ? "" : ` workload=${result.workloadOutcome}`);
                console.error(
                    `[bench] ${spec.key} #${String(i)}${warmup ? " (warmup)" : ""}: ${result.outcome}` +
                        (result.outcome === "ok"
                            ? ` content=${formatMs(result.contentMs)} highlight=${formatMs(result.highlightMs)}` +
                              ` frameWithText=${formatMs(result.ladder?.frameWithText)}` +
                              ` rss=${result.peakRssBytes === null ? "—" : `${String(Math.round(result.peakRssBytes / MiB))} MB`}` +
                              keys
                            : ` exit=${String(result.exitCode)} signal=${String(result.signal)}`),
                );
                // No point burning the remaining runs: the outcome is deterministically bad.
                if (result.outcome === "crash") break;
            }
            sizes.push(summarizeSize(fixture, fixtureBytes, results, floors));
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
            conditions: describeConditions(process.env, cli.label),
            ci: process.env.GITHUB_ACTIONS === "true",
        },
        floors,
        sizes,
    };

    const markdown = renderMarkdown(report);
    if (cli.jsonPath !== null) {
        mkdirSync(dirname(cli.jsonPath), { recursive: true });
        writeFileSync(cli.jsonPath, JSON.stringify(report, null, 2) + "\n");
    }
    if (cli.mdPath !== null) {
        mkdirSync(dirname(cli.mdPath), { recursive: true });
        writeFileSync(cli.mdPath, markdown);
    }
    console.log(markdown);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
