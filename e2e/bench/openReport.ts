/** The docs/public/BENCH-OPEN.md page is overwritten by `bench.yml`. */

import type { OpenFixture } from "./openFixtures.ts";
import { MiB } from "./openFixtures.ts";
import type { OpenRunResult, WorkloadStepKey } from "./openMeasure.ts";
import { WORKLOAD_STEPS } from "./openMeasure.ts";
import type { FloorResult } from "./ptyFloor.ts";
import { MILESTONES } from "./startupLadder.ts";
import { NOISY_IQR_RATIO, type Stats, statsOf } from "./stats.ts";

export interface SizeReport {
    readonly key: string;
    readonly kind: string;
    readonly fixtureBytes: number;
    readonly fixtureLines: number;
    readonly runs: readonly OpenRunResult[];
    /** Time to text, ms from spawn (black box). */
    readonly content: Stats | null;
    readonly highlight: Stats | null;
    /** Our ms: time to text − node floor (the headline number). */
    readonly ours: Stats | null;
    /** Time to text − binary floor (`diode --version`): startup internals without bundle parsing. */
    readonly overBinary: Stats | null;
    readonly peakRss: Stats | null;
    /** Mark ladder, mark → per-run stats (ms from spawn). */
    readonly ladder: Readonly<Record<string, Stats | null>>;
    /** Black box vs white box gap: time to text (PTY) − frame with text (trace). */
    readonly boxGap: Stats | null;
    readonly workload: Readonly<Record<WorkloadStepKey, Stats | null>>;
    readonly workloadFailures: readonly string[];
}

export interface ReportEnv {
    readonly cpu: string;
    readonly cores: number;
    readonly memGb: number;
    readonly platform: string;
    readonly conditions: string;
    readonly ci: boolean;
}

export interface FullReport {
    readonly generatedAt: string;
    readonly commit: string;
    readonly binaryVersion: string;
    readonly env: ReportEnv;
    readonly floors: {
        /** `diode --version`: runtime + SEA bundle parsing. */
        readonly binary: FloorResult;
        /** `node -e ""`: the minimal process that runs JS — "our ms" is measured from it. */
        readonly node: FloorResult;
        /** `node --version`: for reference only — it answers before V8 starts, so it is not a floor. */
        readonly nodeVersion: FloorResult;
    };
    readonly sizes: readonly SizeReport[];
}

export function summarizeSize(
    fixture: OpenFixture,
    fixtureBytes: number,
    runs: readonly OpenRunResult[],
    floors: FullReport["floors"],
): SizeReport {
    const measured = runs.filter((r) => !r.warmup && r.outcome === "ok");
    const ladder: Record<string, Stats | null> = {};
    for (const m of MILESTONES) {
        ladder[m.key] = statsOf(measured.map((r) => r.ladder?.[m.key]));
    }
    const workload = {} as Record<WorkloadStepKey, Stats | null>;
    for (const step of WORKLOAD_STEPS) {
        workload[step.key] = statsOf(
            measured.map((r) => r.workload.find((w) => w.key === step.key)?.latencyMs ?? null),
        );
    }
    const contentValues = measured.map((r) => r.contentMs);
    return {
        key: fixture.key,
        kind: fixture.kind,
        fixtureBytes,
        fixtureLines: fixture.lines,
        runs,
        content: statsOf(contentValues),
        highlight: statsOf(measured.map((r) => r.highlightMs)),
        ours: statsOf(contentValues.map((v) => (v === null ? null : v - floors.node.medianMs))),
        overBinary: statsOf(contentValues.map((v) => (v === null ? null : v - floors.binary.medianMs))),
        peakRss: statsOf(measured.map((r) => r.peakRssBytes)),
        ladder,
        boxGap: statsOf(
            measured.map((r) => {
                const frame = r.ladder?.frameWithText;
                return r.contentMs === null || frame === null || frame === undefined ? null : r.contentMs - frame;
            }),
        ),
        workload,
        workloadFailures: measured
            .filter((r) => r.workloadOutcome !== "ok" && r.workloadOutcome !== "skipped")
            .map((r) =>
                r.workloadOutcome === "crash"
                    ? `crash${r.signal !== null ? ` (signal ${String(r.signal)})` : ""}`
                    : `failed${r.workloadError !== null ? `: ${r.workloadError}` : ""}`,
            ),
    };
}


export function formatMs(value: number | null | undefined): string {
    return value === null || value === undefined ? "—" : `${String(Math.round(value))} ms`;
}

export function formatBytes(bytes: number): string {
    if (bytes >= MiB) return `${(bytes / MiB).toFixed(bytes >= 100 * MiB ? 0 : 1)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatIqr(s: Stats | null): string {
    if (s === null) return "—";
    return `${String(Math.round(s.iqr))} ms${s.noisy ? " ⚠ noisy" : ""}`;
}

function medianCell(s: Stats | null | undefined): string {
    return formatMs(s?.median);
}

function outcomeNote(size: SizeReport): string {
    // Failures count across all runs, including the warmup: a crash during
    // warmup is not noise but the result itself ("the file does not open").
    const failed = size.runs.filter((r) => r.outcome !== "ok");
    if (failed.length === 0) return "";
    return ` ${failed
        .map((r) => (r.signal !== null ? `${r.outcome} (signal ${String(r.signal)})` : r.outcome))
        .join(", ")}`;
}

export function renderMarkdown(report: FullReport): string {
    const lines: string[] = [];
    const noisyPercent = String(Math.round(NOISY_IQR_RATIO * 100));
    lines.push("# File open benchmark");
    lines.push("");
    lines.push(`- Recorded: ${report.generatedAt}, commit \`${report.commit}\`, diode ${report.binaryVersion}`);
    lines.push(
        `- Machine: ${report.env.cpu} (${String(report.env.cores)} cores, ${String(report.env.memGb)} GB), ${report.env.platform}`,
    );
    lines.push(`- Conditions: ${report.env.conditions}`);
    lines.push(
        `- node floor (\`node -e ""\` over PTY, median): ${formatMs(report.floors.node.medianMs)}; ` +
            `binary floor (\`diode --version\` over PTY, median): ${formatMs(report.floors.binary.medianMs)}; ` +
            `for reference \`node --version\`: ${formatMs(report.floors.nodeVersion.medianMs)} (answers before V8 starts)`,
    );
    lines.push("");

    lines.push("## Over the floor");
    lines.push("");
    lines.push(
        "The headline number is **our ms**: time to text minus the node floor (what everything of ours " +
            'costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing ' +
            "(`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the " +
            `interquartile range, a row with IQR > ${noisyPercent} % of the median is marked "noisy".`,
    );
    lines.push("");
    lines.push(
        "| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |",
    );
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const size of report.sizes) {
        const measured = size.runs.filter((r) => !r.warmup && r.outcome === "ok");
        const cells = [
            `\`${size.key}\``,
            formatBytes(size.fixtureBytes),
            String(size.fixtureLines),
            `**${medianCell(size.ours)}**`,
            medianCell(size.overBinary),
            medianCell(size.content) + outcomeNote(size),
            size.kind === "log" ? "— (plaintext)" : medianCell(size.highlight),
            formatIqr(size.content),
            size.peakRss === null ? "—" : formatBytes(size.peakRss.median),
            String(measured.length),
        ];
        lines.push(`| ${cells.join(" | ")} |`);
    }
    lines.push("");

    lines.push("## Mark ladder (white box)");
    lines.push("");
    lines.push(
        "`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. " +
            "The last rows are the black box (same run, from PTY bytes) and the gap " +
            '"to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.',
    );
    lines.push("");
    lines.push(`| mark | ${report.sizes.map((s) => `\`${s.key}\``).join(" | ")} |`);
    lines.push(`| --- | ${report.sizes.map(() => "---:").join(" | ")} |`);
    for (const m of MILESTONES) {
        lines.push(`| ${m.label} | ${report.sizes.map((s) => medianCell(s.ladder[m.key])).join(" | ")} |`);
    }
    lines.push(`| to text (black box) | ${report.sizes.map((s) => medianCell(s.content)).join(" | ")} |`);
    lines.push(`| to highlight (black box) | ${report.sizes.map((s) => medianCell(s.highlight)).join(" | ")} |`);
    lines.push(`| gap black − white (text) | ${report.sizes.map((s) => medianCell(s.boxGap)).join(" | ")} |`);
    lines.push("");

    lines.push("## Workload after open");
    lines.push("");
    lines.push(
        "Keystroke latency: from the write to the PTY to the frame where the change is visible " +
            "(median ms). The cursor is mid-file; search types one word as a single paste event.",
    );
    lines.push("");
    lines.push(`| file | ${WORKLOAD_STEPS.map((s) => s.label).join(" | ")} |`);
    lines.push(`| --- | ${WORKLOAD_STEPS.map(() => "---:").join(" | ")} |`);
    for (const size of report.sizes) {
        const note = size.workloadFailures.length === 0 ? "" : ` ${[...new Set(size.workloadFailures)].join(", ")}`;
        lines.push(
            `| \`${size.key}\`${note} | ${WORKLOAD_STEPS.map((s) => medianCell(size.workload[s.key])).join(" | ")} |`,
        );
    }
    lines.push("");

    lines.push(
        "Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment " +
            "(its own user-data-dir and HOME); time is counted from process spawn; the moment " +
            "text/highlighting appears is recovered from stdout chunk timestamps. " +
            "The node and binary floors are taken in the same run the same way (spawn over PTY, " +
            'until the first output chunk): the node floor is `node -e ""`, the minimal process with a full ' +
            "V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); " +
            "the binary floor is `diode --version`, i.e. plus SEA bundle parsing. " +
            '"To highlight" is the first frame where a keyword is colored by the theme. ' +
            "Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). " +
            "LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.",
    );
    lines.push("");
    return lines.join("\n");
}
