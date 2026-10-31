#!/usr/bin/env node
/**
 * `npm run test:api-conformance`: runs upstream's `vscode-api-tests` inside the real editor, one
 * session per test file, and compares the green tests with the baseline. See docs/TESTING.md.
 *
 *   --update              rewrite the baseline from this run
 *   --only a,b            only these test files (baselines of the others stay untouched)
 *   --file-timeout <sec>  time limit of one test file
 *   --hang <suite>        hang the extension host in this file, to see the others survive
 *   --keep                keep the working directory
 */

import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs, promisify } from "node:util";

import { buildExtension, SUITES } from "./build.mjs";
import { compareSuite, formatReport, greenTitles, parseResults, readBaseline, staleExclusions, testKey, unfinishedTitles, writeBaseline } from "./compare.mjs";
import { extractUpstreamApiTests } from "./upstream.mjs";

const here = import.meta.dirname;
const repoRoot = path.resolve(here, "..", "..");
const baselineDir = path.join(here, "baseline");
const SESSION = "api-conformance";
const TEST_TIMEOUT_MS = 8000;
const DEFAULT_FILE_TIMEOUT_S = 300;

const execFileAsync = promisify(execFile);

function drive(args, timeoutMs) {
    return execFileAsync(path.join(repoRoot, "node_modules", ".bin", "tsx"), [path.join("tools", "drive", "cli.ts"), ...args], {
        cwd: repoRoot,
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
    });
}

async function runSession({ suite, workDir, vsix, hang, fileTimeoutMs, buildExtensions }) {
    const resultsFile = path.join(workDir, "results", `${suite}.jsonl`);
    const workspace = path.join(workDir, "testWorkspace");
    // A fresh workspace each time: tests leave files behind and the next suite must not see them.
    rmSync(workspace, { recursive: true, force: true });
    cpSync(path.join(workDir, "upstream", "testWorkspace"), workspace, { recursive: true });
    writeFileSync(path.join(workDir, "current.json"), JSON.stringify({ suite, hang }));

    const deadline = Date.now() + fileTimeoutMs;
    let problem;
    try {
        await drive(["start", "-s", SESSION, "--open", workspace, "--install", vsix, ...(buildExtensions ? [] : ["--no-build"])], Math.max(fileTimeoutMs, 300_000));
        await drive(["exec", "-s", SESSION, "_apiConformance.run", "--no-await"], 60_000);
        while (Date.now() < deadline && !(existsSync(resultsFile) && parseResults(readFileSync(resultsFile, "utf8")).ended)) {
            await delay(500);
        }
        if (Date.now() >= deadline) problem = `did not finish in ${String(fileTimeoutMs / 1000)} s`;
    } catch (error) {
        problem = `session failed: ${String(error?.stderr || error?.message).trim().slice(0, 800)}`;
    }
    // A stuck editor must not hold up the other files: stop kills whatever does not exit by itself.
    await drive(["stop", "-s", SESSION], 120_000).catch(() => undefined);
    return { results: parseResults(existsSync(resultsFile) ? readFileSync(resultsFile, "utf8") : ""), problem };
}

const { values } = parseArgs({
    options: {
        update: { type: "boolean", default: false },
        only: { type: "string" },
        "file-timeout": { type: "string", default: String(DEFAULT_FILE_TIMEOUT_S) },
        hang: { type: "string" },
        keep: { type: "boolean", default: false },
    },
});

const suites = values.only === undefined ? SUITES : values.only.split(",");
for (const suite of suites) {
    if (!SUITES.includes(suite)) throw new Error(`Unknown test file ${suite}. Known: ${SUITES.join(" ")}`);
}
const exclusions = JSON.parse(readFileSync(path.join(here, "exclusions.json"), "utf8"));

const workDir = mkdtempSync(path.join(os.tmpdir(), "diode-api-conformance-"));
mkdirSync(path.join(workDir, "results"));
const upstreamDir = extractUpstreamApiTests(repoRoot, path.join(workDir, "upstream"));
const extensionDir = path.join(workDir, "extension");
await buildExtension({ repoRoot, upstreamDir, extensionDir, workDir, testTimeoutMs: TEST_TIMEOUT_MS });
const vsix = path.join(workDir, "api-tests.vsix");
await execFileAsync(process.execPath, [path.join(repoRoot, "scripts", "pack-vsix.mjs"), extensionDir, vsix]);

await drive(["stop", "-s", SESSION], 60_000).catch(() => undefined);

const report = [];
const details = {};
for (const [index, suite] of suites.entries()) {
    const startedAt = Date.now();
    const { results, problem } = await runSession({
        suite,
        workDir,
        vsix,
        hang: values.hang === suite,
        fileTimeoutMs: Number(values["file-timeout"]) * 1000,
        buildExtensions: index === 0,
    });
    const green = greenTitles(results);
    const unfinished = unfinishedTitles(results);
    if (values.update && problem === undefined && results.loadError === undefined) writeBaseline(baselineDir, suite, green, exclusions, new Set(results.skipped));
    const isExcluded = (title) => Object.hasOwn(exclusions, testKey(suite, title));
    const planned = results.planned.length > 0 ? results.planned : [...green];
    report.push({
        suite,
        greenCount: [...green].filter((title) => !isExcluded(title)).length,
        redCount: planned.filter((title) => !green.has(title) && !results.skipped.includes(title) && !isExcluded(title)).length,
        skippedCount: results.skipped.length,
        unfinishedCount: unfinished.length,
        excludedCount: planned.filter(isExcluded).length,
        comparison: compareSuite({ suite, green, skipped: new Set(results.skipped), baseline: readBaseline(baselineDir, suite), exclusions }),
    });
    details[suite] = { problem, planned: results.planned, loadError: results.loadError, green: [...green].sort(), failed: Object.fromEntries(results.failed), skipped: results.skipped, unfinished };
    console.log(`${suite}: ${String(green.size)} green of ${String(planned.length)} in ${String(Math.round((Date.now() - startedAt) / 1000))} s${problem === undefined ? "" : ` (${problem})`}`);
    if (results.loadError !== undefined) console.log(results.loadError);
}

const stale = staleExclusions(exclusions, details);
const text = [formatReport(report), ...(stale.length > 0 ? ["", "Exclusions that match no test:", ...stale.map((key) => `  ${key}`)] : [])].join("\n");
console.log(`\n${text}`);

const reportDir = path.join(repoRoot, "reports", "api-conformance");
mkdirSync(reportDir, { recursive: true });
writeFileSync(path.join(reportDir, "summary.json"), JSON.stringify({ report, details }, null, 1));
writeFileSync(path.join(reportDir, "summary.txt"), `${text}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## API conformance\n\n\`\`\`\n${text}\n\`\`\`\n`);

if (values.keep) console.log(`Working directory: ${workDir}`);
else rmSync(workDir, { recursive: true, force: true });

const failed = !values.update && report.some((suite) => suite.comparison.regressions.length > 0);
process.exitCode = failed ? 1 : 0;
