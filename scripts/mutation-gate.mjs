/** Pure logic of the mutation gate, shared by `mutation-diff.mjs` and `mutation-report.mjs`. */

/**
 * `stryker run --help`, v10. Tells a flag value (`--concurrency 4`) from the
 * positional `[configFile]` (`--incremental X`).
 */
const STRYKER_BOOLEAN_FLAGS = new Set([
    "--ignoreStatic",
    "--incremental",
    "--allowEmpty",
    "--force",
    "--dryRunOnly",
    "--disableBail",
    "--inPlace",
]);

/** A separate class for `.claude/hooks/bash-guard.mjs`: the hook refuses exactly where the gate would fail. */
export class PositionalArgumentError extends Error {
    constructor(arg) {
        super(`Unexpected positional argument "${arg}". The diff base is set with a flag: --base ${arg}`);
        this.arg = arg;
    }
}

/**
 * A positional argument is an error: the npm script puts `--ignoreStatic --incremental`
 * first, and `npm run test:mutation -- X` silently passed `X` to Stryker as a config name.
 */
export function parseArgs(argv) {
    let base = null;
    let scopeOnly = false;
    const strykerArgs = [];
    const verify = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--scope-only") {
            scopeOnly = true;
            continue;
        }
        if (arg === "--verify-full") {
            verify.full = true;
            continue;
        }
        if (arg in VERIFY_NUMBER_FLAGS) {
            const value = Number(argv[++i]);
            if (!Number.isFinite(value) || value <= 0) throw new Error(`${arg} requires a positive number`);
            const [option, scale] = VERIFY_NUMBER_FLAGS[arg];
            verify[option] = value * scale;
            continue;
        }
        if (arg === "--base" || arg.startsWith("--base=")) {
            const value = arg === "--base" ? argv[++i] : arg.slice("--base=".length);
            if (value === undefined || value === "" || value.startsWith("-")) {
                throw new Error("--base requires a revision: --base <ref>");
            }
            base = value;
            continue;
        }
        if (!arg.startsWith("-")) {
            const prev = strykerArgs.at(-1);
            const isFlagValue =
                prev !== undefined && prev.startsWith("-") && !prev.includes("=") && !STRYKER_BOOLEAN_FLAGS.has(prev);
            if (!isFlagValue) {
                throw new PositionalArgumentError(arg);
            }
        }
        strykerArgs.push(arg);
    }
    return { base, scopeOnly, verify, strykerArgs: ensureJsonReporter(strykerArgs) };
}

/**
 * `--verify-budget` from the environment when the flag is absent: MUTATION_DEADLINE_MS is an
 * epoch-ms moment set by the local budget wrapper (scripts/agent-loop/mutation-budget.mjs);
 * the re-verification gets whatever is left until then (nothing, if it is already past).
 */
export function verifyBudgetUntil(verify, env = process.env, now = Date.now()) {
    if (verify.budgetMs !== undefined) return verify;
    const deadline = Number(env.MUTATION_DEADLINE_MS);
    if (!Number.isFinite(deadline) || deadline <= 0) return verify;
    return { ...verify, budgetMs: Math.max(0, deadline - now) };
}

/** Flag → `verifyMutants` option and unit multiplier. */
const VERIFY_NUMBER_FLAGS = {
    "--verify-jobs": ["jobs", 1],
    "--verify-timeout": ["timeoutMs", 1000],
    "--verify-budget": ["budgetMs", 60_000],
};

/** Without the json reporter there is no `mutation.json` and hence no verdict; other reporters stay. */
export function ensureJsonReporter(args) {
    return args.map((arg, i) => {
        if (arg.startsWith("--reporters=")) return `--reporters=${withJson(arg.slice("--reporters=".length))}`;
        if (args[i - 1] === "--reporters") return withJson(arg);
        return arg;
    });
}

function withJson(list) {
    const reporters = list.split(",").filter(Boolean);
    return reporters.includes("json") ? list : [...reporters, "json"].join(",");
}

/**
 * Same fields as Stryker's (`mutantToIdentifyingKey`). Without the end and the
 * replacement, `→ true` and `→ false` at one position merged, and the killed one
 * marked the other as killed too.
 */
export function mutantKey(file, mutant) {
    const { start, end } = mutant.location;
    return `${file}@${start.line}:${start.column}-${end.line}:${end.column}\n${mutant.mutatorName}: ${String(mutant.replacement)}`;
}

export function parseScope(entries) {
    return entries.map((entry) => {
        const match = /^(.*):(\d+)-(\d+)$/.exec(entry);
        if (match === null) return { file: entry, start: 1, end: Infinity };
        return { file: match[1], start: Number(match[2]), end: Number(match[3]) };
    });
}

/** Entirely inside the range, like `locationIncluded` of the Stryker instrumenter. */
export function inScope(scope, file, mutant) {
    const start = mutant.location?.start?.line;
    if (start === undefined) return false;
    const end = mutant.location?.end?.line ?? start;
    return scope.some((entry) => entry.file === file && start >= entry.start && end <= entry.end);
}

/** Incremental Stryker appends old results outside `--mutate`, from previous branches and before a rebase. */
export function filterReportToScope(report, scope) {
    let dropped = 0;
    for (const [file, data] of Object.entries(report.files ?? {})) {
        const kept = (data.mutants ?? []).filter((mutant) => inScope(scope, file, mutant));
        dropped += (data.mutants ?? []).length - kept.length;
        if (kept.length === 0) delete report.files[file];
        else data.mutants = kept;
    }
    return dropped;
}

/**
 * Exactly Stryker's formula (`mutation-testing-metrics`). An empty denominator gives 100
 * (Stryker gives NaN, which does not break the threshold either).
 */
export function scoreReport(report) {
    const counts = {
        Killed: 0,
        Timeout: 0,
        Survived: 0,
        NoCoverage: 0,
        RuntimeError: 0,
        CompileError: 0,
        Ignored: 0,
        Pending: 0,
    };
    for (const data of Object.values(report.files ?? {})) {
        for (const mutant of data.mutants ?? []) {
            if (mutant.status in counts) counts[mutant.status]++;
        }
    }
    const detected = counts.Killed + counts.Timeout;
    const valid = detected + counts.Survived + counts.NoCoverage;
    return { counts, detected, valid, score: valid === 0 ? 100 : (detected / valid) * 100 };
}

/**
 * Hunks of `git diff -U0 --no-prefix` by file: `{ oldStart, oldCount, newStart, newCount }`.
 * `--no-prefix` rather than parsing `+++ b/…`: with `diff.mnemonicPrefix` git prints
 * `+++ w/…`, the scope comes out empty and the gate silently turns green.
 */
export function parseDiff(diff) {
    const scope = new Map();
    // Counts files without mutable lines too: it tells "parser broken" from "diff of deletions only".
    let headers = 0;
    let current = null;
    let prevWasOldFileHeader = false;

    for (const line of diff.split("\n")) {
        // Only right after `---`: an added line `++ x` looks like `+++ x` in the diff.
        if (prevWasOldFileHeader && line.startsWith("+++ ")) {
            const file = line.slice(4);
            headers++;
            current = file === "/dev/null" ? null : file;
            prevWasOldFileHeader = false;
            continue;
        }
        prevWasOldFileHeader = line.startsWith("--- ");
        if (prevWasOldFileHeader) continue;
        if (!current) continue;

        const hunkMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (!hunkMatch) continue;

        const newCount = hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4]);
        if (newCount === 0) continue;

        if (!scope.has(current)) scope.set(current, []);
        scope.get(current).push({
            oldStart: Number(hunkMatch[1]),
            oldCount: hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]),
            newStart: Number(hunkMatch[3]),
            newCount,
        });
    }
    return { scope, headers };
}
