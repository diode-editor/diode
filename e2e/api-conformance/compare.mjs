/**
 * Result of one suite against its baseline, and the text of the report. No I/O besides the files
 * of the baseline itself, so the verdict logic is testable without an editor.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

/** Results file of a session: JSON lines, the last of which may be cut off by a killed editor. */
export function parseResults(text) {
    const results = { planned: [], passed: [], failed: new Map(), skipped: [], ended: false, loadError: undefined };
    for (const line of text.split("\n")) {
        if (line.trim() === "") continue;
        let record;
        try {
            record = JSON.parse(line);
        } catch {
            continue;
        }
        if (record.kind === "plan") results.planned = record.titles;
        else if (record.kind === "pass") results.passed.push(record.title);
        else if (record.kind === "fail") results.failed.set(record.title, record.error);
        else if (record.kind === "skip") results.skipped.push(record.title);
        else if (record.kind === "load-error") results.loadError = record.error;
        else if (record.kind === "end") results.ended = true;
    }
    return results;
}

/** A test that passed and then failed in a later hook is not green. */
export function greenTitles(results) {
    return new Set(results.passed.filter((title) => !results.failed.has(title)));
}

/** Planned tests that neither finished nor were skipped: the session stopped before them. */
export function unfinishedTitles(results) {
    const finished = new Set([...results.passed, ...results.failed.keys(), ...results.skipped]);
    return results.planned.filter((title) => !finished.has(title));
}

export const testKey = (suite, title) => `${suite} ${title}`;

/**
 * A baseline test that skipped itself is not red: upstream's tests skip on what the machine lacks
 * (`window.state.focused` is false on a headless CI runner).
 *
 * @param {{suite: string, green: Set<string>, skipped?: Set<string>, baseline: Set<string>, exclusions: Record<string, string>}} input
 */
export function compareSuite({ suite, green, skipped = new Set(), baseline, exclusions }) {
    const isExcluded = (title) => Object.hasOwn(exclusions, testKey(suite, title));
    return {
        regressions: [...baseline].filter((title) => !green.has(title) && !skipped.has(title) && !isExcluded(title)).sort(),
        baselineSkipped: [...baseline].filter((title) => skipped.has(title) && !isExcluded(title)).sort(),
        newGreen: [...green].filter((title) => !baseline.has(title) && !isExcluded(title)).sort(),
        // A flaky test passes now and then by definition, that is not news.
        excludedGreen: [...green].filter((title) => isExcluded(title) && !exclusions[testKey(suite, title)].startsWith("flaky")).sort(),
    };
}

/** Keys of suites that ran and announced a plan, naming a test that plan does not have: a typo or a renamed test. */
export function staleExclusions(exclusions, details) {
    return Object.keys(exclusions).filter((key) =>
        Object.entries(details).some(([suite, { planned }]) => planned.length > 0 && key.startsWith(`${suite} `) && !planned.includes(key.slice(suite.length + 1))),
    );
}

export function baselinePath(baselineDir, suite) {
    return path.join(baselineDir, `${suite}.txt`);
}

export function readBaseline(baselineDir, suite) {
    const file = baselinePath(baselineDir, suite);
    if (!existsSync(file)) return new Set();
    return new Set(readFileSync(file, "utf8").split("\n").filter((line) => line !== ""));
}

/** Sorted, one title per line: parallel PRs rarely touch the same line. */
export function formatBaseline(titles) {
    return titles.length === 0 ? "" : `${[...titles].sort().join("\n")}\n`;
}

/** A baseline test that skipped itself in this run stays: the run says nothing about it. */
export function writeBaseline(baselineDir, suite, green, exclusions, skipped = new Set()) {
    mkdirSync(baselineDir, { recursive: true });
    const kept = [...readBaseline(baselineDir, suite)].filter((title) => skipped.has(title));
    const titles = [...new Set([...green, ...kept])].filter((title) => !Object.hasOwn(exclusions, testKey(suite, title)));
    writeFileSync(baselinePath(baselineDir, suite), formatBaseline(titles));
}

/**
 * @param {{suite: string, greenCount: number, redCount: number, skippedCount: number, unfinishedCount: number, excludedCount: number, comparison: ReturnType<typeof compareSuite>}[]} suites
 */
export function formatReport(suites) {
    const sum = (pick) => suites.reduce((total, suite) => total + pick(suite), 0);
    const lines = suites.map(
        (s) =>
            `${s.suite.padEnd(20)} green ${String(s.greenCount).padStart(3)}  red ${String(s.redCount).padStart(3)}  skipped ${String(s.skippedCount).padStart(2)}` +
            `  excluded ${String(s.excludedCount).padStart(2)}${s.unfinishedCount > 0 ? `  unfinished ${String(s.unfinishedCount)}` : ""}`,
    );
    lines.push(
        "",
        `Total: ${String(sum((s) => s.greenCount))} green, ${String(sum((s) => s.redCount))} red, ${String(sum((s) => s.skippedCount))} skipped, ${String(sum((s) => s.excludedCount))} excluded.`,
    );
    const section = (title, pick) => {
        const entries = suites.flatMap((s) => pick(s.comparison).map((test) => `  ${testKey(s.suite, test)}`));
        if (entries.length > 0) lines.push("", title, ...entries);
    };
    section("REGRESSIONS (green in the baseline, not green now):", (c) => c.regressions);
    section("Baseline tests that skipped themselves in this run:", (c) => c.baselineSkipped);
    section("New green tests outside the baseline. Add them: npm run test:api-conformance -- --update", (c) => c.newGreen);
    section("Excluded tests that pass. Check e2e/api-conformance/exclusions.json:", (c) => c.excludedGreen);
    return lines.join("\n");
}
