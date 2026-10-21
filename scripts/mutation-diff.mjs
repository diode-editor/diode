#!/usr/bin/env node
/**
 * Mutation testing of the code a task touched: surviving mutants are holes in
 * its tests that coverage cannot see.
 *
 * StrykerJS has NO `--since` (that is a Stryker.NET option), so we compute the
 * diff scope ourselves and pass it via `--mutate`: a new file in full, an edited
 * one by hunk lines (`src/a.ts:120-160`) where the code changed, not only comments or
 * layout (`changedCodeRanges`). An empty scope exits with zero.
 *
 * Usage: npm run test:mutation [-- --base <ref>] [-- <extra Stryker flags>]
 * The default base is the merge-base with a fresh `origin/main` (fetches it
 * itself; on failure uses what is there, then the local `main`).
 *
 * Own flags (the rest go to Stryker):
 *   --base <ref>    diff base. A positional argument is an error: it used to
 *                   silently go to Stryker as a config file name;
 *   --scope-only    print the scope and exit;
 *   --incremental   incremental Stryker (reports/stryker-incremental.json);
 *                   a reused "survived" is still re-verified.
 *                   Full recompute: `-- --incremental --force`;
 *   --verify-jobs N        re-verification sandboxes (default 1: vitest already
 *                          takes all cores);
 *   --verify-full          third stage: the whole suite for mutants not killed by narrow runs;
 *   --verify-timeout <s>   vitest run timeout (default 120 s + 3 s per file);
 *   --verify-budget <min>  re-verification budget: mutants left over are inconclusive.
 *
 * Mutants Stryker did not kill are re-verified by injection in
 * `scripts/verify-mutants.mjs`; classes go to `reports/mutation/verdict.json`.
 * The outcome goes to `reports/mutation/gate.json`
 * (`outcome: empty-scope | passed | failed | error`); no file means the script crashed.
 * A missing `mutation.json` alone cannot tell "nothing to mutate" from "broken":
 * the nightly run stayed green that way for three weeks while checking nothing.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { changedCodeRanges } from "./code-tokens.mjs";
import { filterReportToScope, parseArgs, parseDiff, parseScope, scoreReport } from "./mutation-gate.mjs";
import { blockingVerdicts, countClasses, isCandidate, mergeVerdicts } from "./mutation-inject.mjs";
import { formatSummary, verifyMutants, writeVerdictFile } from "./verify-mutants.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

const SOURCE_ROOTS = ["src/", "extensions/"];

const EXCLUDED = [
    /\.test\.ts$/,
    /\.bench\.ts$/,
    /\.stories\.ts$/,
    /\.d\.ts$/,
    /^src\/demos\//,
    /^src\/StoryRunner\//,
    /\/__fixtures__\//,
    // A surviving mutant here can only be killed by editing the generator.
    /\.generated\.ts$/,
    // A surviving mutant in a fake means "nobody uses this capability", not a hole in the tests.
    /^src\/TestUtils\//,
    // A test helper next to production modules: its mutant is killed only by a test of the test.
    /^src\/vs\/diode\/modules\/testProfile\.ts$/,
    // Zero mutants, but `builtinActions.when.test.ts` reads the file AS TEXT, and
    // the Stryker instrumenter reprints it, which breaks indentation-based parsing.
    /^src\/vs\/platform\/contextkey\/common\/contextKeys\.ts$/,
    // Vendored copy of upstream: changed only via scripts/import-vscode-editor.mjs.
    /^src\/vs\/editor\/common\/diff\//,
    /^src\/vs\/base\/common\/(charCode|stopwatch)\.ts$/,
    /^src\/vs\/editor\/common\/model\/(textModelTokens|fixedArray)\.ts$/,
    /^src\/vs\/editor\/common\/core\/misc\/eolCounter\.ts$/,
    /^src\/vs\/editor\/common\/encodedTokenAttributes\.ts$/,
    /^src\/vs\/editor\/common\/tokens\/(lineTokens|contiguousMultilineTokens|contiguousMultilineTokensBuilder|contiguousTokensEditing)\.ts$/,
    /^src\/vs\/editor\/common\/languages\/nullTokenize\.ts$/,
    /^src\/vs\/editor\/common\/model\/pieceTreeTextBuffer\//,
    /^src\/vs\/editor\/common\/model\/textModelSearch\.ts$/,
    /^src\/vs\/editor\/common\/core\/(textChange|wordCharacterClassifier|characterClassifier)\.ts$/,
    /^src\/vs\/base\/common\/uint\.ts$/,
    // Test shims at upstream paths: the same kind of test helpers as src/TestUtils/.
    /^src\/vs\/editor\/test\/common\/testTextModel\.ts$/,
    /^src\/vs\/base\/test\//,
    // Process barrier: runs in the extension host child process, which
    // `globalThis.__stryker__` does not reach, so every mutant is "not covered"
    // and cannot be killed. A tool limitation, not "untested": integration tests
    // exist. Lifting it requires passing the active mutant and coverage across the process.
    /^extensions\/[^/]+\/main\.ts$/,
    // Same process barrier; covered by integration suites with a real subprocess.
    /^src\/vs\/workbench\/services\/extensions\/node\/extensionHostSubprocess\.ts$/,
    // Same barrier: runs only in a fork of the binary (DIODE_RUN_AS_NODE); child-process tests gate it.
    /^src\/vs\/diode\/runAsNode(\.testEntry)?\.ts$/,
    // Same barrier: runs only in a fork (DIODE_FILE_WATCHER); gated by treeWatcherMain.integration.test.ts and e2e.
    /^src\/vs\/platform\/files\/node\/treeWatcherMain(\.testEntry)?\.ts$/,
    // Excluded from coverage, checked by e2e against the binary; the mutable logic lives in the modules it wires together.
    /^src\/vs\/diode\/main\.ts$/,
    // Same process barrier: entry points of role lazy chunks, gated by e2e on the SEA binary.
    /^src\/vs\/diode\/roles\/[^/]+\.ts$/,
    /^extensions\/[^/]+\/out\//,
];

function git(args) {
    // Otherwise diff parsing depends on the caller's ~/.gitconfig.
    const result = spawnSync("git", ["-c", "core.quotepath=false", "--no-pager", ...args], {
        cwd: repoRoot,
        encoding: "utf8",
        // The default is 1 MB, but the nightly window diff is 11.7 MB: overflow kills git
        // with SIGTERM (ENOBUFS) and an empty stderr, and the nightly run failed silently.
        maxBuffer: 1024 * 1024 * 1024,
    });
    if (result.status !== 0) {
        const why = result.error ? `${result.error.message}${result.signal ? ` (${result.signal})` : ""}` : result.stderr;
        throw new Error(`git ${args.join(" ")} failed:\n${why}`);
    }
    return result.stdout;
}

function isMutable(file) {
    if (!SOURCE_ROOTS.some((root) => file.startsWith(root))) return false;
    if (!file.endsWith(".ts")) return false;
    return !EXCLUDED.some((pattern) => pattern.test(file));
}

const REPORT_DIR = path.join(repoRoot, "reports", "mutation");
const REPORT_PATH = path.join(REPORT_DIR, "mutation.json");
const GATE_PATH = path.join(REPORT_DIR, "gate.json");

// First thing: if the script crashes below, the workflow would read a stale file as this run's outcome.
rmSync(GATE_PATH, { force: true });

let args;
try {
    args = parseArgs(process.argv.slice(2));
} catch (error) {
    console.error(error.message);
    process.exit(2);
}
const { scopeOnly, strykerArgs } = args;

/** A fresh `origin/main`: the local `main` of a long-lived checkout drags other merged PRs into the scope. */
function resolveBase(explicit) {
    if (explicit !== null) return { base: explicit, mergeBase: git(["merge-base", explicit, "HEAD"]).trim() };
    const fetch = spawnSync("git", ["fetch", "origin", "main", "--quiet"], {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    if (fetch.status !== 0) console.warn("Could not update origin/main; using the local copy.");
    for (const candidate of ["origin/main", "main"]) {
        const result = spawnSync("git", ["merge-base", candidate, "HEAD"], { cwd: repoRoot, encoding: "utf8" });
        if (result.status === 0) return { base: candidate, mergeBase: result.stdout.trim() };
    }
    throw new Error("Neither origin/main nor main found; set the base explicitly: --base <ref>");
}

const { base, mergeBase } = resolveBase(args.base);
console.log(`Base: ${base} → merge-base ${git(["log", "-1", "--format=%h %s", mergeBase]).trim()}`);

function finish(outcome, code, extra = {}) {
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(GATE_PATH, JSON.stringify({ outcome, base, mergeBase, ...extra }, null, 2));
    process.exit(code);
}

const added = new Set(
    git(["diff", "--name-only", "--diff-filter=A", mergeBase, "--"])
        .split("\n")
        .filter(Boolean),
);

// Files not added to the index are missing from the diff but are copied into the Stryker sandbox.
const untracked = git(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean);
for (const file of untracked) added.add(file);

const diff = git([
    "diff",
    "-U0",
    "--no-prefix",
    "--no-color",
    "--no-ext-diff",
    mergeBase,
    "--",
    ...SOURCE_ROOTS,
]);
const { scope, headers } = parseDiff(diff);

if (diff.trim() !== "" && headers === 0) {
    throw new Error(
        "Could not parse git diff output: no files recognized " +
            "although the diff is not empty. The mutation scope would be empty and the gate would pass without checking anything.",
    );
}

for (const file of untracked) if (!scope.has(file)) scope.set(file, []);

const mutate = [];
for (const [file, hunks] of scope) {
    if (!isMutable(file)) continue;
    if (added.has(file)) {
        mutate.push(file);
        continue;
    }
    // A renamed file has no text at the base under its new path: its hunks stay whole.
    const before = spawnSync("git", ["show", `${mergeBase}:${file}`], { cwd: repoRoot, encoding: "utf8", maxBuffer: 1 << 28 });
    const ranges =
        before.status === 0
            ? changedCodeRanges(file, before.stdout, readFileSync(path.join(repoRoot, file), "utf8"), hunks)
            : hunks.map((h) => [h.newStart, h.newStart + h.newCount - 1]);
    for (const [start, end] of ranges) {
        mutate.push(`${file}:${start}-${end}`);
    }
}

if (mutate.length === 0) {
    console.log(
        `Nothing to mutate: the diff against ${base} (${mergeBase.slice(0, 8)}) has no ` +
            `code changes in product code under src//extensions/ (comments and layout do not count).`,
    );
    if (!scopeOnly) finish("empty-scope", 0);
    process.exit(0);
}

console.log(`Mutation scope (${mutate.length} entries against ${base}):`);
for (const entry of mutate) console.log(`  ${entry}`);

if (scopeOnly) process.exit(0);

const mutateScope = parseScope(mutate);

/**
 * Linux caps a single argument at 128 KiB (MAX_ARG_STRLEN), but the nightly window
 * `--mutate` is 196 KB (E2BIG): a large scope goes into a copy of stryker.config.json.
 * Stryker resolves its paths from cwd, so the copy can live anywhere.
 */
const MUTATE_ARG_LIMIT = 100_000;
const SCOPE_CONFIG_PATH = path.join(repoRoot, "reports", "stryker.scope.json");

function runStryker(scope, extraArgs = []) {
    let target = ["--mutate", scope.join(",")];
    if (target[1].length > MUTATE_ARG_LIMIT) {
        const config = JSON.parse(readFileSync(path.join(repoRoot, "stryker.config.json"), "utf8"));
        mkdirSync(path.dirname(SCOPE_CONFIG_PATH), { recursive: true });
        writeFileSync(SCOPE_CONFIG_PATH, JSON.stringify({ ...config, mutate: scope }, null, 2));
        target = [path.relative(repoRoot, SCOPE_CONFIG_PATH)];
    }
    return spawnSync("npx", ["stryker", "run", ...target, ...extraArgs, ...strykerArgs], {
        cwd: repoRoot,
        stdio: "inherit",
    });
}

function readReport() {
    if (!existsSync(REPORT_PATH)) return null;
    return JSON.parse(readFileSync(REPORT_PATH, "utf8"));
}

function breakThreshold() {
    const config = JSON.parse(readFileSync(path.join(repoRoot, "stryker.config.json"), "utf8"));
    return config.thresholds?.break ?? null;
}

/**
 * Judged by the final report, not by the Stryker exit code: incremental Stryker
 * also counts old mutants outside `--mutate` in the score. Classes without a verdict
 * fail the gate on their own: the score does not see them, and "could not check"
 * is not "checked".
 */
function verdict(report, verdicts = []) {
    const threshold = breakThreshold();
    const { score } = scoreReport(report);
    const blocking = blockingVerdicts(verdicts);
    const passed = (threshold === null || score >= threshold) && blocking.length === 0;
    console.log(`\nMutation score for the scope: ${score.toFixed(2)}% (threshold ${String(threshold)}).`);
    if (blocking.length > 0) {
        console.log(
            `${String(blocking.length)} mutants without a verdict (${formatSummary(blocking)}): the gate stays red ` +
                "until they are triaged (docs/MUTATION.md).",
        );
    }
    finish(passed ? "passed" : "failed", passed ? 0 : 1, {
        score,
        threshold,
        classes: countClasses(verdicts),
        blocking: blocking.map(({ file, line, mutatorName, class: cls, reason }) => ({
            file,
            line,
            mutatorName,
            class: cls,
            reason: reason.split("\n")[0],
        })),
    });
}

/**
 * The old report is removed BEFORE the run: Stryker writes it at the very end, and a
 * run that died earlier (the initial test run runs the whole suite, a normal case)
 * would leave the gate someone else's mutants (#339).
 */
function runFresh(scope, extraArgs = []) {
    rmSync(REPORT_PATH, { force: true });
    const startedAt = Date.now();
    const { status } = runStryker(scope, extraArgs);
    if (!existsSync(REPORT_PATH)) return { status, report: null };
    // One second of slack for the coarse mtime of some file systems.
    if (statSync(REPORT_PATH).mtimeMs < startedAt - 1000) {
        throw new Error(`${REPORT_PATH} is older than the Stryker run: it is another run's report.`);
    }
    return { status, report: readReport() };
}

const first = runFresh(mutate);
if (first.report === null) {
    console.error(
        `\nStryker left no report (code ${String(first.status ?? "—")}), so there is no verdict. ` +
            "See its output above: most often the initial test run failed.",
    );
    finish("error", 1, { reason: "the first Stryker run left no report" });
}

const firstReport = first.report;
const dropped = filterReportToScope(firstReport, mutateScope);
if (dropped > 0) {
    console.log(
        `\nDropped ${String(dropped)} out-of-scope mutants from the report: stale results ` +
            "of incremental mode (previous branches, code before a rebase).",
    );
}
// Write to disk right away: the PR comment and the issue are built from it even if something fails later.
writeFileSync(REPORT_PATH, JSON.stringify(firstReport));
// Not a second Stryker run with a line scope: it did not fix test selection misses
// (`vitest.related`, perTest coverage) and was itself a flake (#339).
const candidates = Object.values(firstReport.files ?? {}).flatMap((data) => (data.mutants ?? []).filter(isCandidate));
if (candidates.length === 0) verdict(firstReport);

console.log(
    `\nNot killed by Stryker: ${String(candidates.length)}. Re-verifying each by injecting the exact mutant ` +
        "(phantom / real / inconclusive, see docs/MUTATION.md):",
);
let verdicts = [];
try {
    verdicts = await verifyMutants({ root: repoRoot, report: firstReport, ...args.verify });
} catch (error) {
    console.error(`\nRe-verification failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    finish("error", 1, { reason: "re-verification by injection failed" });
}
mergeVerdicts(firstReport, verdicts);
writeFileSync(REPORT_PATH, JSON.stringify(firstReport));
writeVerdictFile(REPORT_DIR, verdicts);
console.log(`\nRe-verified by injection: ${formatSummary(verdicts)}.`);
verdict(firstReport, verdicts);
