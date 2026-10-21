/** Pure functions of the e2e run: how many workers, what failed, what is a flake. */

import { availableParallelism, freemem, totalmem } from "node:os";
import { relative } from "node:path";

const GiB = 1024 ** 3;

/** Worst case: vitest + editor + extension host + language server; measured in docs/TESTING.md. */
export const WORKER_BYTES = 1.5 * GiB;
export const RESERVE_BYTES = 2 * GiB;
/** Free memory is a snapshot, and the run itself eats some of it. */
export const AVAILABLE_HEADROOM_BYTES = 1 * GiB;

/**
 * The smallest of three limits:
 *
 *  - half the cores: a full binary on every core saturates the CPU, and timing tests
 *    (restart, RPC, PTY input) flake;
 *  - total memory (or the cgroup limit) minus a reserve;
 *  - memory free RIGHT NOW minus headroom: the machine is shared, and a run sized by
 *    total memory went OOM next to a neighbor's mutation gate.
 *
 * @param {{ cpus?: number, totalBytes?: number, constrainedBytes?: number, availableBytes?: number, env?: Record<string, string | undefined> }} [machine]
 * @returns {{ workers: number, reason: string }}
 */
export function planWorkers(machine = {}) {
    const {
        cpus = availableParallelism(),
        totalBytes = totalmem(),
        constrainedBytes = process.constrainedMemory?.() ?? 0,
        availableBytes = freemem(),
        env = process.env,
    } = machine;
    const explicit = env.DIODE_E2E_WORKERS;
    if (explicit !== undefined && explicit !== "") {
        const n = Math.max(1, Math.floor(Number(explicit)) || 1);
        return { workers: n, reason: `DIODE_E2E_WORKERS=${explicit}` };
    }
    // Without a limit constrainedMemory returns a huge number (2^64) or 0.
    const limit = constrainedBytes > 0 && constrainedBytes < totalBytes ? constrainedBytes : totalBytes;
    const byCpu = Math.floor(cpus / 2);
    const byTotal = Math.floor((limit - RESERVE_BYTES) / WORKER_BYTES);
    const byAvailable = Math.floor((availableBytes - AVAILABLE_HEADROOM_BYTES) / WORKER_BYTES);
    const workers = Math.max(1, Math.min(byCpu, byTotal, byAvailable));
    const gb = (bytes) => (bytes / GiB).toFixed(1);
    return {
        workers,
        reason:
            `cores ${String(cpus)}/2 → ${String(byCpu)}; memory ${gb(limit)} GB − ${gb(RESERVE_BYTES)} → ${String(byTotal)}; ` +
            `free ${gb(availableBytes)} GB − ${gb(AVAILABLE_HEADROOM_BYTES)} → ${String(byAvailable)} ` +
            `(${gb(WORKER_BYTES)} GB per worker)`,
    };
}

/**
 * @param {{ testResults?: { name: string, status: string, message?: string, assertionResults?: { fullName?: string, title?: string, status: string, failureMessages?: string[] }[] }[] }} report
 * @param {string} repoRoot
 * @returns {{ files: number, failed: { file: string, tests: { name: string, message: string }[] }[] }}
 */
export function analyzeReport(report, repoRoot) {
    const results = report.testResults ?? [];
    const failed = [];
    for (const result of results) {
        if (result.status !== "failed") continue;
        const tests = (result.assertionResults ?? [])
            .filter((a) => a.status === "failed")
            .map((a) => ({ name: a.fullName ?? a.title ?? "?", message: firstLine(a.failureMessages?.[0]) }));
        // The file itself failed (import, hook, beforeAll timeout): the cause is in message.
        if (tests.length === 0) tests.push({ name: "(whole file)", message: firstLine(result.message) });
        failed.push({ file: relative(repoRoot, result.name).replaceAll("\\", "/"), tests });
    }
    return { files: results.length, failed };
}

function firstLine(text) {
    return (text ?? "").split("\n").find((l) => l.trim().length > 0)?.trim().slice(0, 300) ?? "";
}

/**
 * A flake fails in the first pass and is green in the second: both use the same immutable binary.
 *
 * @param {{ failed: { file: string, tests: { name: string, message: string }[] }[] }} first
 * @param {{ failed: { file: string }[] } | null} second `null` when there was no second pass
 * @returns {{ ok: boolean, flaky: { file: string, tests: { name: string, message: string }[] }[], broken: { file: string, tests: { name: string, message: string }[] }[] }}
 */
export function verdict(first, second) {
    if (first.failed.length === 0) return { ok: true, flaky: [], broken: [] };
    if (second === null) return { ok: false, flaky: [], broken: first.failed };
    const stillFailing = new Set(second.failed.map((f) => f.file));
    const flaky = first.failed.filter((f) => !stillFailing.has(f.file));
    const broken = first.failed.filter((f) => stillFailing.has(f.file));
    return { ok: broken.length === 0, flaky, broken };
}

/**
 * @param {ReturnType<typeof verdict>} result
 * @param {{ files: number, workers: number, retried: boolean, wallSeconds: number }} info
 */
export function renderSummary(result, info) {
    const lines = [];
    const status = result.ok ? (result.flaky.length > 0 ? "green, with flakes" : "green") : "RED";
    lines.push(`### e2e: ${status}`);
    lines.push("");
    lines.push(
        `${String(info.files)} files, workers ${String(info.workers)}, ${String(Math.round(info.wallSeconds))} s` +
            (info.retried ? "; failed files rerun one by one" : ""),
    );
    const section = (title, entries) => {
        if (entries.length === 0) return;
        lines.push("", `**${title}** (${String(entries.length)}):`, "");
        for (const entry of entries) {
            lines.push(`- \`${entry.file}\``);
            for (const t of entry.tests) lines.push(`  - ${t.name}${t.message ? ` — ${t.message}` : ""}`);
        }
    };
    section("FLAKY: failed in the first pass, green in the second", result.flaky);
    section("FAILED", result.broken);
    return `${lines.join("\n")}\n`;
}
