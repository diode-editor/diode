/** Чистые функции прогона e2e: сколько воркеров, что упало, что флак. */

import { availableParallelism, freemem, totalmem } from "node:os";
import { relative } from "node:path";

const GiB = 1024 ** 3;

/** Худший случай: vitest + редактор + субпроцесс расширений + языковой сервер; замер — docs/TESTING.md. */
export const WORKER_BYTES = 1.5 * GiB;
export const RESERVE_BYTES = 2 * GiB;
/** Свободная память — снимок, и прогон сам её чуть съест. */
export const AVAILABLE_HEADROOM_BYTES = 1 * GiB;

/**
 * Меньшее из трёх ограничений:
 *
 *  - половина ядер: полный бинарь на каждом ядре насыщает CPU, и тайминг-тесты
 *    (рестарт, RPC, PTY-ввод) флейкают;
 *  - вся память (или лимит cgroup) минус резерв;
 *  - свободная СЕЙЧАС память минус запас: машина общая, и прогон, посчитанный от
 *    полной памяти, уходил в OOM рядом с мутационным гейтом соседа.
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
    // constrainedMemory без лимита отдаёт огромное число (2^64) или 0.
    const limit = constrainedBytes > 0 && constrainedBytes < totalBytes ? constrainedBytes : totalBytes;
    const byCpu = Math.floor(cpus / 2);
    const byTotal = Math.floor((limit - RESERVE_BYTES) / WORKER_BYTES);
    const byAvailable = Math.floor((availableBytes - AVAILABLE_HEADROOM_BYTES) / WORKER_BYTES);
    const workers = Math.max(1, Math.min(byCpu, byTotal, byAvailable));
    const gb = (bytes) => (bytes / GiB).toFixed(1);
    return {
        workers,
        reason:
            `ядра ${String(cpus)}/2 → ${String(byCpu)}; память ${gb(limit)} ГБ − ${gb(RESERVE_BYTES)} → ${String(byTotal)}; ` +
            `свободно ${gb(availableBytes)} ГБ − ${gb(AVAILABLE_HEADROOM_BYTES)} → ${String(byAvailable)} ` +
            `(по ${gb(WORKER_BYTES)} ГБ на воркер)`,
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
        // Упал сам файл (импорт, хук, таймаут beforeAll) — причина в message.
        if (tests.length === 0) tests.push({ name: "(файл целиком)", message: firstLine(result.message) });
        failed.push({ file: relative(repoRoot, result.name).replaceAll("\\", "/"), tests });
    }
    return { files: results.length, failed };
}

function firstLine(text) {
    return (text ?? "").split("\n").find((l) => l.trim().length > 0)?.trim().slice(0, 300) ?? "";
}

/**
 * Флак — упал в первом проходе и зелёный во втором: бинарь у них один и неизменяемый.
 *
 * @param {{ failed: { file: string, tests: { name: string, message: string }[] }[] }} first
 * @param {{ failed: { file: string }[] } | null} second `null` — второго прохода не было
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
    const status = result.ok ? (result.flaky.length > 0 ? "зелёный, с флаками" : "зелёный") : "КРАСНЫЙ";
    lines.push(`### e2e: ${status}`);
    lines.push("");
    lines.push(
        `${String(info.files)} файлов, воркеров ${String(info.workers)}, ${String(Math.round(info.wallSeconds))} с` +
            (info.retried ? "; упавшие файлы перепрогнаны поодиночке" : ""),
    );
    const section = (title, entries) => {
        if (entries.length === 0) return;
        lines.push("", `**${title}** (${String(entries.length)}):`, "");
        for (const entry of entries) {
            lines.push(`- \`${entry.file}\``);
            for (const t of entry.tests) lines.push(`  - ${t.name}${t.message ? ` — ${t.message}` : ""}`);
        }
    };
    section("FLAKY — упал в первом проходе, зелёный во втором", result.flaky);
    section("FAILED", result.broken);
    return `${lines.join("\n")}\n`;
}
