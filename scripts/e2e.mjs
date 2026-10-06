#!/usr/bin/env node
/**
 * `npm run test:e2e`: прогон e2e с автоповтором упавших файлов.
 *
 *   Проход 1 — весь набор (или то, что отфильтровано аргументами), воркеров по
 *              ядрам и памяти (`planWorkers`), JSON-репорт в reports/e2e/.
 *   Проход 2 — только упавшие файлы, ОДНИМ воркером, на том же неизменяемом бинаре
 *              из кэша (scripts/e2e-artifacts.mjs — второй globalSetup попадает в кэш).
 *
 * Вердикт: код 0 — только если второй проход зелёный. Файлы, упавшие в первом и
 * прошедшие во втором, — **FLAKY**: печатаются списком вместе с упавшими тестами
 * и сообщениями (и в `$GITHUB_STEP_SUMMARY` в CI). Флак не прячется: его видно в
 * каждом прогоне, пока его не починят.
 *
 * Почему не `retry` vitest: он повторяет тест в том же воркере, под той же
 * нагрузкой и молча — флак становится невидимым. Здесь повтор — в тишине одного
 * воркера, а флак — в итоге.
 *
 * Когда повтора нет:
 *  - упало больше {@link RETRY_MAX} файлов — это не флак, а поломка (повтор
 *    стоил бы ещё один полный прогон);
 *  - vitest вышел с ошибкой, но упавших файлов в репорте нет (необработанная
 *    ошибка, упавший globalSetup) — повторять нечего;
 *  - `DIODE_E2E_RETRY=0`.
 *
 * Аргументы передаются vitest как есть: `npm run test:e2e -- e2e/mouse.test.ts`.
 */

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { analyzeReport, planWorkers, renderSummary, verdict } from "./e2e-plan.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const reportDir = join(repoRoot, "reports", "e2e");
const vitestBin = join(repoRoot, "node_modules", "vitest", "vitest.mjs");
const RETRY_MAX = Number(process.env.DIODE_E2E_RETRY_MAX ?? 8);
const retryEnabled = process.env.DIODE_E2E_RETRY !== "0";

let interrupted = false;
let current = null;
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        // Ctrl+C терминал шлёт всей группе — vitest получит его сам; SIGTERM
        // (лиза, CI) — передаём. Второго прохода после прерывания не будет.
        interrupted = true;
        current?.kill(signal);
    });
}

/** Один проход vitest; возвращает код выхода и разобранный репорт (или null). */
function runPass(name, args, workers) {
    const reportPath = join(reportDir, `${name}.json`);
    rmSync(reportPath, { force: true });
    const fullArgs = [
        vitestBin,
        "run",
        "--config",
        "vitest.e2e.config.ts",
        "--reporter=default",
        "--reporter=json",
        `--outputFile.json=${reportPath}`,
        ...args,
    ];
    console.error(`\n[e2e] ${name}: воркеров ${String(workers)}${args.length > 0 ? `, ${args.join(" ")}` : ""}\n`);
    return new Promise((resolvePass) => {
        current = spawn(process.execPath, fullArgs, {
            cwd: repoRoot,
            stdio: "inherit",
            env: { ...process.env, DIODE_E2E_WORKERS: String(workers) },
        });
        current.on("exit", (code, signal) => {
            current = null;
            let report = null;
            if (existsSync(reportPath)) {
                try {
                    report = analyzeReport(JSON.parse(readFileSync(reportPath, "utf-8")), repoRoot);
                } catch {
                    // недописанный репорт (прогон убит) — как отсутствующий
                }
            }
            resolvePass({ code: code ?? (signal === null ? 1 : 128), report });
        });
    });
}

async function main() {
    const args = process.argv.slice(2);
    mkdirSync(reportDir, { recursive: true });
    const started = Date.now();
    const plan = planWorkers();
    console.error(`[e2e] воркеров: ${String(plan.workers)} (${plan.reason})`);

    const first = await runPass("pass1", args, plan.workers);
    if (interrupted) return 130;
    if (first.report === null) {
        console.error(`[e2e] нет репорта первого прохода (код ${String(first.code)}) — прогон не состоялся, повторять нечего`);
        return first.code || 1;
    }
    if (first.code !== 0 && first.report.failed.length === 0) {
        console.error(
            `[e2e] vitest вышел кодом ${String(first.code)}, но упавших файлов нет — ` +
                "необработанная ошибка или упавший globalSetup (см. вывод выше); повтор не поможет",
        );
        return first.code;
    }

    let second = null;
    const failedFiles = first.report.failed.map((f) => f.file);
    if (failedFiles.length > 0 && retryEnabled && failedFiles.length <= RETRY_MAX) {
        console.error(`\n[e2e] упало файлов: ${String(failedFiles.length)} — перепрогон поодиночке:\n  ${failedFiles.join("\n  ")}`);
        const rerun = await runPass("pass2", failedFiles, 1);
        if (interrupted) return 130;
        // Нет репорта или ошибка без упавших файлов — считаем, что все остались красными.
        second = rerun.report !== null && !(rerun.code !== 0 && rerun.report.failed.length === 0) ? rerun.report : first.report;
    } else if (failedFiles.length > RETRY_MAX) {
        console.error(`\n[e2e] упало файлов: ${String(failedFiles.length)} > ${String(RETRY_MAX)} — это не флак, повтора не будет`);
    }

    const result = verdict(first.report, second);
    const summary = renderSummary(result, {
        files: first.report.files,
        workers: plan.workers,
        retried: second !== null,
        wallSeconds: (Date.now() - started) / 1000,
    });
    console.error(`\n${summary}`);
    writeFileSync(join(reportDir, "summary.md"), summary);
    writeFileSync(join(reportDir, "summary.json"), `${JSON.stringify(result, null, 2)}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    if (process.env.GITHUB_ACTIONS === "true") {
        for (const f of result.flaky) console.log(`::warning file=${f.file}::FLAKY e2e: ${f.tests.map((t) => t.name).join("; ")}`);
    }
    return result.ok ? 0 : 1;
}

process.exitCode = await main();
