#!/usr/bin/env node
/**
 * `npm run test:e2e`: the whole suite, then the failed files once more with ONE worker on the
 * same cached binary. Files that pass the second time are printed as FLAKY (also to
 * `$GITHUB_STEP_SUMMARY`) instead of being hidden.
 *
 * Not vitest `retry`: it repeats in the same worker, under the same load, and silently.
 *
 * No retry when more than {@link RETRY_MAX} files failed (a breakage, not a flake), when the
 * report has no failed files (globalSetup failed) and with `DIODE_E2E_RETRY=0`.
 *
 * Arguments go to vitest as is: `npm run test:e2e -- e2e/mouse.test.ts`.
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
        // The terminal sends Ctrl+C to the whole group, but SIGTERM (lease, CI) has to be forwarded.
        interrupted = true;
        current?.kill(signal);
    });
}

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
    console.error(`\n[e2e] ${name}: workers ${String(workers)}${args.length > 0 ? `, ${args.join(" ")}` : ""}\n`);
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
                    // a half-written report (the run was killed) counts as missing
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
    console.error(`[e2e] workers: ${String(plan.workers)} (${plan.reason})`);

    const first = await runPass("pass1", args, plan.workers);
    if (interrupted) return 130;
    if (first.report === null) {
        console.error(`[e2e] no first-pass report (code ${String(first.code)}): the run did not happen, nothing to retry`);
        return first.code || 1;
    }
    if (first.code !== 0 && first.report.failed.length === 0) {
        console.error(
            `[e2e] vitest exited with code ${String(first.code)}, but no files failed: ` +
                "an unhandled error or a failed globalSetup (see the output above); a retry won't help",
        );
        return first.code;
    }

    let second = null;
    const failedFiles = first.report.failed.map((f) => f.file);
    if (failedFiles.length > 0 && retryEnabled && failedFiles.length <= RETRY_MAX) {
        console.error(`\n[e2e] failed files: ${String(failedFiles.length)}, rerunning one by one:\n  ${failedFiles.join("\n  ")}`);
        const rerun = await runPass("pass2", failedFiles, 1);
        if (interrupted) return 130;
        // No report, or an error without failed files: they all stay red.
        second = rerun.report !== null && !(rerun.code !== 0 && rerun.report.failed.length === 0) ? rerun.report : first.report;
    } else if (failedFiles.length > RETRY_MAX) {
        console.error(`\n[e2e] failed files: ${String(failedFiles.length)} > ${String(RETRY_MAX)}, not a flake, no retry`);
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
