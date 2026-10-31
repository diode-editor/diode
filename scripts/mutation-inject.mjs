/**
 * Pure logic of the mutation gate self-check, with no processes or file system
 * (`verify-mutants.mjs` does those).
 *
 * Why: Stryker with `perTest` and `vitest.related` reports as Survived mutants that
 * the tests do kill, and debunking them by hand went wrong: people injected the
 * "meaning" of a mutant (`if (false)` on the whole condition instead of the left
 * operand of `||`), and real holes ended up as phantoms (#343).
 */

import { mutantKey } from "./mutation-gate.mjs";

/**
 * The order is the display order.
 *
 *   real          — all selected tests are green with the mutant: a real hole;
 *   runtime-error — no test failed, but vitest itself did (unhandled error, worker):
 *                   CI is red, while the Stryker score does not see it;
 *   inconclusive  — no verdict: red without the mutant, nothing to run, did not
 *                   reproduce, budget ran out;
 *   timeout       — vitest with the mutant did not finish in time;
 *   stale         — the source is not the one Stryker applied the mutant to;
 *   phantom       — a test green without the mutant turns red with it (reproducibly).
 */
export const CLASSES = ["real", "runtime-error", "inconclusive", "timeout", "stale", "phantom"];

/** Fail the gate on their own; `real` fails it through the score (stays Survived/NoCoverage). */
export const BLOCKING_CLASSES = new Set(["runtime-error", "inconclusive", "timeout", "stale"]);

export function isCandidate(mutant) {
    return mutant.status === "Survived" || mutant.status === "NoCoverage" || mutant.status === "RuntimeError";
}

/** Both line and column in the Stryker report are 1-based. */
export function offsetOf(text, position) {
    let offset = 0;
    for (let line = 1; line < position.line; line++) {
        const next = text.indexOf("\n", offset);
        if (next < 0) throw new Error(`line ${String(position.line)} is out of range`);
        offset = next + 1;
    }
    const lineEnd = text.indexOf("\n", offset);
    const lineLength = (lineEnd < 0 ? text.length : lineEnd) - offset;
    // A mutant may end right after the last character of a line (column = length + 1).
    if (position.column < 1 || position.column - 1 > lineLength) {
        throw new Error(`column ${String(position.column)} is out of range in line ${String(position.line)}`);
    }
    return offset + position.column - 1;
}

/** Verbatim, nothing "by meaning": Stryker often mutates HALF of an expression (the left operand of `||`). */
export function applyMutant(source, mutant) {
    const from = offsetOf(source, mutant.location.start);
    const to = offsetOf(source, mutant.location.end);
    if (to < from) throw new Error("mutant ends before it starts");
    return source.slice(0, from) + String(mutant.replacement ?? "") + source.slice(to);
}

export function coveringTestFiles(report, mutant) {
    const ids = new Set(mutant.coveredBy ?? []);
    if (ids.size === 0) return [];
    const files = [];
    for (const [file, data] of Object.entries(report.testFiles ?? {})) {
        if ((data.tests ?? []).some((test) => ids.has(test.id))) files.push(file);
    }
    return files.sort();
}

export function siblingTestFiles(sourceFile, allFiles) {
    const slash = sourceFile.lastIndexOf("/");
    const dir = sourceFile.slice(0, slash + 1);
    const base = sourceFile.slice(slash + 1).replace(/\.ts$/, "");
    return allFiles
        .filter((file) => {
            if (!file.startsWith(dir) || file.slice(dir.length).includes("/")) return false;
            const name = file.slice(dir.length);
            return name === `${base}.test.ts` || (name.startsWith(`${base}.`) && name.endsWith(".test.ts"));
        })
        .sort();
}

const IMPORT_PATTERNS = [
    /\b(?:import|export)\s[^;'"`]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\b(?:import|require|vi\.mock|vi\.doMock)\s*\(\s*["']([^"']+)["']/g,
];

export function importSpecifiers(text) {
    const found = new Set();
    for (const pattern of IMPORT_PATTERNS) {
        for (const match of text.matchAll(pattern)) {
            if (match[1].startsWith("./") || match[1].startsWith("../")) found.add(match[1]);
        }
    }
    return [...found];
}

function normalize(file) {
    const out = [];
    for (const part of file.split("/")) {
        if (part === "" || part === ".") continue;
        if (part === "..") out.pop();
        else out.push(part);
    }
    return out.join("/");
}

export function resolveSpecifier(fromFile, specifier, known) {
    const dir = fromFile.slice(0, fromFile.lastIndexOf("/") + 1);
    const target = normalize(dir + specifier);
    const candidates = [target, target.replace(/\.(m?js)$/, ".ts"), `${target}.ts`, `${target}/index.ts`];
    return candidates.find((candidate) => known.has(candidate)) ?? null;
}

/**
 * Our own rather than `vitest related`, which starts a vite server per call. The graph
 * is wider than the real one (an import in a comment is an edge too), which is the safe
 * side: an extra test costs seconds, a missed one costs a phantom.
 */
export function buildReverseImportGraph(sources) {
    const known = new Set(sources.keys());
    const importers = new Map();
    for (const [file, text] of sources) {
        for (const specifier of importSpecifiers(text)) {
            const target = resolveSpecifier(file, specifier, known);
            if (target === null) continue;
            if (!importers.has(target)) importers.set(target, new Set());
            importers.get(target).add(file);
        }
    }
    return importers;
}

export function relatedTestFiles(file, importers) {
    const seen = new Set([file]);
    const queue = [file];
    while (queue.length > 0) {
        const current = queue.shift();
        for (const importer of importers.get(current) ?? []) {
            if (seen.has(importer)) continue;
            seen.add(importer);
            queue.push(importer);
        }
    }
    return [...seen].filter((candidate) => candidate.endsWith(".test.ts")).sort();
}

/** `failedFiles` are files that failed as a whole (did not load, a hook failed) without a single failed test. */
export function parseVitestJson(json) {
    const passed = new Set();
    const failed = new Set();
    const failedFiles = new Set();
    const ranFiles = new Set();
    for (const result of json.testResults ?? []) {
        const file = result.name;
        ranFiles.add(file);
        let failedHere = false;
        for (const assertion of result.assertionResults ?? []) {
            const key = `${file} > ${assertion.fullName}`;
            if (assertion.status === "passed") passed.add(key);
            else if (assertion.status === "failed") {
                failed.add(key);
                failedHere = true;
            }
        }
        if (result.status === "failed" && !failedHere) failedFiles.add(file);
    }
    return { passed, failed, failedFiles, ranFiles, total: json.numTotalTests ?? passed.size + failed.size };
}

/** A failure without the mutant is not evidence; otherwise a test red from the network would record phantoms. */
export function killers(baseline, mutated) {
    const tests = [...mutated.failed].filter((key) => baseline.passed.has(key));
    const files = [...mutated.failedFiles].filter(
        (file) =>
            baseline.ranFiles.has(file) &&
            !baseline.failedFiles.has(file) &&
            ![...baseline.failed].some((key) => key.startsWith(`${file} > `)),
    );
    return { tests: tests.sort(), files: files.sort(), any: tests.length + files.length > 0 };
}

export function baselineIsRed(baseline) {
    return baseline.failed.size > 0 || baseline.failedFiles.size > 0;
}

const RUNTIME_ERROR_MARKERS = [
    /Unhandled (?:Errors?|Rejection)/i,
    /Worker exited unexpectedly/i,
    /Channel closed/i,
    /ERR_IPC_CHANNEL_CLOSED/,
];

/**
 * vitest failed, but its report names no failed test. With `--bail` this is not yet a crash: two files
 * failing at once can cancel the run before either failure reaches the report (#921).
 */
export function exitedWithoutFailures(run) {
    return run.code !== 0 && run.result !== null && run.result.failed.size === 0 && run.result.failedFiles.size === 0;
}

export function runtimeErrorExcerpt(output) {
    const lines = output.split("\n");
    const at = lines.findIndex((line) => RUNTIME_ERROR_MARKERS.some((marker) => marker.test(line)));
    if (at < 0) return null;
    const clean = (line) =>
        line
            .replace(/\u001b\[[0-9;]*m/g, "")
            .replace(/⎯+/g, "")
            .trim();
    // The vitest header explains nothing; we need the error itself.
    const meaningful = lines
        .slice(at + 1, at + 30)
        .map(clean)
        .filter(
            (line) =>
                line !== "" &&
                !/^[⎯\s]+$/.test(line) &&
                !/Vitest caught|false positive|Unhandled (?:Errors?|Rejection)\s*⎯/i.test(line),
        );
    const header = clean(lines[at]).replace(/[⎯]+/g, "").trim();
    return [header, ...meaningful.slice(0, 5)].join("\n");
}

function originalText(source, mutant) {
    return source.slice(offsetOf(source, mutant.location.start), offsetOf(source, mutant.location.end));
}

const BOUNDARY_PAIRS = new Map([
    ["<", "<="],
    ["<=", "<"],
    [">", ">="],
    [">=", ">"],
]);

/**
 * Only a hint on top of `real`: the gate fails just the same, a human decides. The
 * heuristics cover the three cases that most often turned out equivalent.
 */
export function equivalentHint(source, mutant, siblings) {
    let original;
    try {
        original = originalText(source, mutant);
    } catch {
        return null;
    }
    const replacement = String(mutant.replacement ?? "");
    if (mutant.mutatorName === "EqualityOperator") {
        const op = /\s(<=|>=|<|>)\s/.exec(` ${original} `)?.[1];
        const swapped = op === undefined ? null : original.replace(op, BOUNDARY_PAIRS.get(op));
        if (swapped !== null && swapped === replacement)
            return "boundary operator: both branches may give the same result at the boundary";
    }
    if (mutant.mutatorName === "StringLiteral" && /\s|[\u0430-\u044f\u0451]/i.test(original.slice(1, -1))) {
        return "human-readable string (message, label, log): check whether the text needs an assert";
    }
    if (mutant.mutatorName === "ConditionalExpression" && (replacement === "true" || replacement === "false")) {
        const sameSpot = siblings.filter(
            (other) =>
                other !== mutant &&
                other.mutatorName === "ConditionalExpression" &&
                other.location.start.line === mutant.location.start.line &&
                other.location.start.column === mutant.location.start.column &&
                other.location.end.line === mutant.location.end.line &&
                other.location.end.column === mutant.location.end.column,
        );
        if (sameSpot.some((other) => other.status === "Killed" || other.status === "Timeout")) {
            return `guard condition: "→ ${replacement === "true" ? "false" : "true"}" is killed but "→ ${replacement}" is not; the branch may repeat what happens later anyway`;
        }
    }
    return null;
}

/** `verification` lets the PR report show the class, not a bare status. */
export function mergeVerdicts(report, verdicts) {
    const byKey = new Map(verdicts.map((verdict) => [verdict.key, verdict]));
    for (const [file, data] of Object.entries(report.files ?? {})) {
        for (const mutant of data.mutants ?? []) {
            const verdict = byKey.get(mutantKey(file, mutant));
            if (verdict === undefined) continue;
            mutant.verification = {
                class: verdict.class,
                reason: verdict.reason,
                hint: verdict.hint ?? null,
                tests: verdict.tests ?? [],
            };
            if (verdict.class === "phantom") {
                mutant.status = "Killed";
                mutant.statusReason = `verified by injection: ${verdict.reason}`;
            } else if (verdict.class === "runtime-error") {
                mutant.status = "RuntimeError";
                mutant.statusReason = `verified by injection: ${verdict.reason}`;
            } else if (verdict.class === "real" && mutant.status === "RuntimeError") {
                // On re-verification the runner did not crash and the tests are green: the hole is real.
                mutant.status = "Survived";
                mutant.statusReason = `verified by injection: ${verdict.reason}`;
            } else {
                mutant.statusReason = `${verdict.class}: ${verdict.reason}`;
            }
        }
    }
    return report;
}

/** All classes, zeros included. */
export function countClasses(verdicts) {
    const counts = Object.fromEntries(CLASSES.map((name) => [name, 0]));
    for (const verdict of verdicts) counts[verdict.class]++;
    return counts;
}

export function blockingVerdicts(verdicts) {
    return verdicts.filter((verdict) => BLOCKING_CLASSES.has(verdict.class));
}
