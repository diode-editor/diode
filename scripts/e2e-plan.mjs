/**
 * Чистые функции прогона e2e: сколько воркеров, что упало, что флак. Без побочных
 * эффектов — их зовут `vitest.e2e.config.ts` (число воркеров) и `scripts/e2e.mjs`
 * (автоповтор), а проверяет `scripts/e2e-plan.test.mjs`.
 */

import { availableParallelism, freemem, totalmem } from "node:os";
import { relative } from "node:path";

const GiB = 1024 ** 3;

/**
 * Сколько памяти держит один воркер e2e в худшем случае: форк vitest (~0,15 ГБ) +
 * редактор (~0,33) + субпроцесс расширений + языковой сервер (tsserver 0,36,
 * basedpyright 0,39; у java-lsp — две JVM). Замер — docs/TODO/TestRunTime.md.
 */
export const WORKER_BYTES = 1.5 * GiB;
/** Что оставить системе, главному процессу vitest и прочим жильцам машины. */
export const RESERVE_BYTES = 2 * GiB;
/** Запас поверх уже свободной памяти: она снимок, и прогон сам её чуть съест. */
export const AVAILABLE_HEADROOM_BYTES = 1 * GiB;

/**
 * Число воркеров e2e: меньшее из трёх ограничений, не меньше одного.
 *
 *  - ядра: половина — каждый файл поднимает тяжёлый бинарь (+PTY, +субпроцесс
 *    расширений), и четыре таких на четырёх ядрах насыщают CPU: тайминг-тесты
 *    (рестарт, RPC, PTY-ввод) начинают флейкать;
 *  - вся память машины (или лимит cgroup, если он меньше) минус резерв — потолок
 *    на тихой машине;
 *  - свободная СЕЙЧАС память минус запас — потому что машина общая: соседний
 *    сеанс с мутационным гейтом держит гигабайты, и прогон, посчитанный от
 *    полной памяти, уходил в OOM. Свободная память — снимок, но ошибается в
 *    безопасную сторону: занятая машина даёт меньше воркеров.
 *
 * `DIODE_E2E_WORKERS` — явное число, без расчёта.
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
 * Разбор JSON-репорта vitest: какие файлы упали и какие тесты в них.
 *
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
        // Упал сам файл (импорт, хук, таймаут beforeAll) — тестов в нём нет, причина в message.
        if (tests.length === 0) tests.push({ name: "(файл целиком)", message: firstLine(result.message) });
        failed.push({ file: relative(repoRoot, result.name).replaceAll("\\", "/"), tests });
    }
    return { files: results.length, failed };
}

function firstLine(text) {
    return (text ?? "").split("\n").find((l) => l.trim().length > 0)?.trim().slice(0, 300) ?? "";
}

/**
 * Итог двух проходов. Флак — файл, упавший в первом и зелёный во втором (оба
 * прохода гоняют один и тот же неизменяемый бинарь, так что разница — не в коде).
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
 * Markdown-итог для `$GITHUB_STEP_SUMMARY` и для конца вывода.
 *
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
