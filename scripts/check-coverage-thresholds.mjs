#!/usr/bin/env node
/**
 * The coverage gate is 100% and nothing else: every threshold in vitest.config.ts
 * (statements, branches, functions, lines) must be exactly 100. A file that is not worth
 * covering is excluded through `coverage.exclude` (docs/TESTING.md, the exclusion categories),
 * the numbers are never lowered. Twice (#465, #568) they were lowered by hand to green a
 * partial run and nobody noticed for weeks: the ratchet was off while CI stayed green.
 *
 *   node scripts/check-coverage-thresholds.mjs   fail if any threshold is not 100
 */

export const THRESHOLD_KEYS = ["statements", "branches", "functions", "lines"];

/** Thresholds that are not 100, as `key: value` strings; empty when the gate is intact. */
export function problems(thresholds) {
    return THRESHOLD_KEYS.filter((key) => thresholds?.[key] !== 100).map((key) => `${key}: ${String(thresholds?.[key])}`);
}

async function main() {
    const { default: config } = await import("../vitest.config.ts");
    const found = problems(config.test.coverage.thresholds);
    for (const p of found) {
        console.error(`vitest.config.ts: coverage threshold ${p} — the gate is 100; exclude the file in coverage.exclude instead (docs/TESTING.md)`);
    }
    console.log(`check-coverage-thresholds: ${found.length === 0 ? "all four thresholds are 100" : `${found.length} thresholds below 100`}`);
    return found.length === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
