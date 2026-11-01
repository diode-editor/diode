#!/usr/bin/env node
/**
 * Ratchet on `Stryker disable` markers whose reason describes dead code: per source file,
 * their number may only go down. A mutant that survives in an unreachable branch, a defensive
 * guard or a check kept "for the type" points at code to delete, not at an equivalent mutant
 * to silence (docs/MUTATION.md, the order "delete, test, disable").
 * The baseline lives in scripts/stryker-disable-baseline.json; a file missing from it is held to zero.
 * Scope: src/**\/*.ts without tests — the files the mutation gate mutates.
 *
 *   node scripts/check-stryker-disable.mjs            fail if any file exceeds its baseline, listing the markers
 *   node scripts/check-stryker-disable.mjs --update   lower the baseline to current counts (never raises)
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { compare, lowered } from "./ratchet.mjs";

const BASELINE = "scripts/stryker-disable-baseline.json";
// `// Stryker disable [next-line] Mutator[,Mutator]: reason` — the reason is what the ratchet reads.
const MARKER = /\/\/\s*Stryker disable(?:\s+next-line)?\s+(?:all|[A-Za-z]+(?:\s*,\s*[A-Za-z]+)*)\s*:\s*(.+)$/;
// Reasons that describe code nothing can reach: the fix is deleting the code, not silencing the mutant.
export const DEAD_CODE_REASON =
    /\b(?:unreachable|not reachable|defensive|for the type|never (?:happens|null|undefined|zero|empty)|dead (?:code|branch)|is dead|cannot happen|can't happen)\b/i;

export const inScope = (file) => /^src\/.+\.ts$/.test(file) && !/\.test\.ts$/.test(file) && !/\.d\.ts$/.test(file);

/** Markers of the file whose reason reads as dead code: 1-based line and the reason text. */
export function deadCodeMarkers(text) {
    const out = [];
    text.split("\n").forEach((line, i) => {
        const reason = MARKER.exec(line)?.[1];
        if (reason !== undefined && DEAD_CODE_REASON.test(reason)) out.push({ line: i + 1, reason: reason.trim() });
    });
    return out;
}

export function scan() {
    const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8", maxBuffer: 1 << 28 })
        .split("\0")
        .filter((f) => f && inScope(f));
    const markers = {};
    for (const f of files) {
        let text;
        try {
            text = readFileSync(f, "utf8");
        } catch {
            continue; // deleted in the working tree but still in the index
        }
        const found = deadCodeMarkers(text);
        if (found.length > 0) markers[f] = found;
    }
    return markers;
}

function main() {
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
    const markers = scan();
    const counts = Object.fromEntries(Object.entries(markers).map(([f, m]) => [f, m.length]));
    if (process.argv.includes("--update")) {
        const next = lowered(baseline, counts);
        writeFileSync(BASELINE, `${JSON.stringify(next, null, 4)}\n`);
        const total = Object.values(next).reduce((a, b) => a + b, 0);
        console.log(`check-stryker-disable: baseline lowered — ${Object.keys(next).length} files, ${total} markers`);
        return 0;
    }
    const { over, below } = compare(baseline, counts);
    for (const { file, count, allowed } of over) {
        console.error(`${file}: ${count} Stryker disable markers about dead code, baseline ${allowed} — delete the unreachable code instead of silencing the mutant (docs/MUTATION.md)`);
        for (const { line, reason } of markers[file]) console.error(`  ${file}:${line}: ${reason}`);
    }
    if (below.length > 0) {
        console.log(`check-stryker-disable: ${below.length} files below baseline — \`npm run stryker-disable-check -- --update\` lowers it`);
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`check-stryker-disable: ${total} markers about dead code in ${Object.keys(counts).length} files, ${over.length} files over baseline`);
    return over.length === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
