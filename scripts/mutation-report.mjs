#!/usr/bin/env node
/**
 * `reports/mutation/mutation.json` → markdown for the PR comment and the nightly
 * run issue; only surviving mutants are listed.
 *
 * We show a line diff rather than "mutator → replacement": `ConditionalExpression → true`
 * says nothing without the file. The source comes from the report itself
 * (`files[].source`), so rendering does not depend on the current tree.
 *
 * The two kinds of `Ignored` differ only by reason: `// Stryker disable` (the
 * author's decision) and `--ignoreStatic` (the run's decision). ✅/❌ is the gate
 * verdict from `gate.json`; without that file, the config threshold decides.
 *
 * Usage: node scripts/mutation-report.mjs [<path to mutation.json>]
 * Line links appear when GITHUB_REPOSITORY and MUTATION_SHA are set.
 */

import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

import { scoreReport } from "./mutation-gate.mjs";
import { BLOCKING_CLASSES, CLASSES } from "./mutation-inject.mjs";

const CLASS_LABELS = {
    real: "real",
    phantom: "phantom",
    "runtime-error": "runtime-error",
    inconclusive: "inconclusive",
    timeout: "timeout",
    stale: "stale report",
};

const repoRoot = path.resolve(import.meta.dirname, "..");
const reportPath = process.argv[2] ?? path.join(repoRoot, "reports", "mutation", "mutation.json");

if (!existsSync(reportPath)) {
    console.error(`No report: ${reportPath}`);
    process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));

function breakThreshold() {
    try {
        const config = JSON.parse(readFileSync(path.join(repoRoot, "stryker.config.json"), "utf8"));
        return config.thresholds?.break ?? null;
    } catch {
        return null;
    }
}

const threshold = breakThreshold();
const repo = process.env.GITHUB_REPOSITORY ?? "";
const sha = process.env.MUTATION_SHA ?? "";
const canLink = repo !== "" && sha !== "";

const DETAIL_LIMIT = 40;
// GitHub truncates a comment at 65536 characters; the margin is for the "showing N of M" tail.
const CHAR_BUDGET = 55_000;
/** A multiline mutant (a removed function body) is useless in full. */
const SNIPPET_LINES = 3;

function lineLink(file, line) {
    if (!canLink) return `line ${line}`;
    return `[line ${line}](https://github.com/${repo}/blob/${sha}/${file}#L${line})`;
}

function renderDiff(source, mutant) {
    const lines = source.split("\n");
    const { start, end } = mutant.location;
    const first = start.line - 1;
    const last = end.line - 1;
    if (first < 0 || last >= lines.length) return null;

    const original = lines.slice(first, last + 1);
    const head = lines[first].slice(0, start.column - 1);
    const tail = lines[last].slice(end.column - 1);
    const mutated = `${head}${String(mutant.replacement ?? "")}${tail}`.split("\n");

    const clip = (arr) =>
        arr.length > SNIPPET_LINES ? [...arr.slice(0, SNIPPET_LINES), "…"] : arr;

    return { original: clip(original), mutated: clip(mutated) };
}

function gateOutcome() {
    const gatePath = path.join(path.dirname(reportPath), "gate.json");
    if (!existsSync(gatePath)) return null;
    return JSON.parse(readFileSync(gatePath, "utf8")).outcome ?? null;
}

const survivors = [];
let silenced = 0; // silenced by `// Stryker disable`
let skippedStatic = 0; // skipped by `--ignoreStatic`
let noCoverage = 0;
let total = 0;
const classes = Object.fromEntries(CLASSES.map((name) => [name, 0]));
let verified = 0;
const undecided = []; // fail the gate on their own, bypassing the score

for (const [file, data] of Object.entries(report.files)) {
    for (const mutant of data.mutants) {
        total++;
        const cls = mutant.verification?.class;
        if (cls !== undefined) {
            verified++;
            classes[cls]++;
            if (BLOCKING_CLASSES.has(cls)) {
                undecided.push({ file, mutant });
                continue;
            }
        }
        switch (mutant.status) {
            case "Ignored":
                if (/ignoreStatic/.test(mutant.statusReason ?? "")) skippedStatic++;
                else silenced++;
                break;
            case "NoCoverage":
                noCoverage++;
                survivors.push({ file, mutant, source: data.source, uncovered: true });
                break;
            case "Survived":
                survivors.push({ file, mutant, source: data.source, uncovered: false });
                break;
            default:
                break;
        }
    }
}

const { counts, detected, score } = scoreReport(report);
const unchecked = counts.RuntimeError + counts.CompileError;
const outcome = gateOutcome();
const passing = outcome !== null ? outcome === "passed" : (threshold === null || score >= threshold) && undecided.length === 0;

const out = [];

out.push(`### ${passing ? "✅" : "❌"} Mutation score — ${score.toFixed(2)}%`);
out.push("");
out.push("| | |");
out.push("|---|--:|");
out.push(`| Killed | ${detected} |`);
out.push(`| **Survived** | **${survivors.length - noCoverage}** |`);
if (noCoverage > 0) out.push(`| Not covered by any test | ${noCoverage} |`);
if (silenced > 0) out.push(`| Silenced by \`// Stryker disable\` | ${silenced} |`);
if (skippedStatic > 0) out.push(`| Skipped as static | ${skippedStatic} |`);
if (unchecked > 0) out.push(`| Not checked (runner or compilation failed) | ${unchecked} |`);
out.push(`| Total mutants | ${total} |`);
if (verified > 0) {
    const parts = CLASSES.filter((name) => classes[name] > 0).map((name) => `${CLASS_LABELS[name]} ${classes[name]}`);
    out.push(`| Re-verified by injection | ${verified}: ${parts.join(", ")} |`);
}
out.push("");

if (classes.phantom > 0) {
    out.push(
        `> Stryker did not count ${classes.phantom} mutants as killed, yet existing tests kill them, ` +
            "as verified by injecting the exact mutant (gate phantoms, docs/MUTATION.md). " +
            "They count as killed in the score; there is nothing to fix.",
    );
    out.push("");
}

if (undecided.length > 0) {
    out.push(`#### Without a verdict — ${undecided.length}`);
    out.push("");
    out.push("The gate stays red until they are triaged: the score does not see them, and \"could not check\" is not \"checked\". What to do with each class: docs/MUTATION.md.");
    out.push("");
    undecided.sort((a, b) => a.file.localeCompare(b.file) || a.mutant.location.start.line - b.mutant.location.start.line);
    for (const { file, mutant } of undecided.slice(0, DETAIL_LIMIT)) {
        const reason = String(mutant.verification.reason ?? "").split("\n").slice(0, 2).join(" — ").slice(0, 300);
        out.push(
            `- **${CLASS_LABELS[mutant.verification.class]}** · \`${file}\` ${lineLink(file, mutant.location.start.line)} · ` +
                `\`${mutant.mutatorName}\` → \`${String(mutant.replacement ?? "").slice(0, 60)}\` — ${reason}`,
        );
    }
    if (undecided.length > DETAIL_LIMIT) out.push(`- … and ${undecided.length - DETAIL_LIMIT} more`);
    out.push("");
}

if (outcome === "error") {
    out.push("The gate did not reach a verdict; the reason is in the run log. The score above covers what was checked.");
    out.push("");
} else if (threshold !== null && !passing) {
    out.push(`The threshold is ${threshold}%. Each surviving mutant is either killed by a test or silenced with`);
    out.push("`// Stryker disable next-line <mutator>: reason`, and the reason goes to review.");
    out.push("");
}

if (skippedStatic > 0) {
    out.push(
        `> Static mutants (${skippedStatic}) are skipped: this is module top level code (tables, ` +
            `command registrations) that per-test coverage cannot narrow, so it is too expensive ` +
            `for the PR gate. The nightly run checks them, so the score above is higher not because ` +
            `there are no holes, but because this part is checked elsewhere.`,
    );
    out.push("");
}

if (survivors.length === 0) {
    out.push("No surviving mutants: some test caught every injected fault.");
} else {
    const byFile = new Map();
    for (const entry of survivors) {
        if (!byFile.has(entry.file)) byFile.set(entry.file, []);
        byFile.get(entry.file).push(entry);
    }
    const sorted = [...byFile].sort((a, b) => b[1].length - a[1].length);
    for (const [, entries] of sorted) {
        entries.sort(
            (a, b) =>
                a.mutant.location.start.line - b.mutant.location.start.line ||
                a.mutant.location.start.column - b.mutant.location.start.column,
        );
    }

    let shown = 0;
    let budget = CHAR_BUDGET;
    let truncated = false;

    for (const [file, entries] of sorted) {
        if (truncated) break;
        const block = [];
        const uncoveredHere = entries.filter((e) => e.uncovered).length;
        const detail =
            uncoveredHere > 0 && uncoveredHere < entries.length
                ? ` (${entries.length - uncoveredHere} survived, ${uncoveredHere} not covered)`
                : "";
        block.push(
            `<details${sorted.length === 1 ? " open" : ""}><summary><code>${file}</code> — ${entries.length}${detail}</summary>`,
        );
        block.push("");

        // Separate from `shown`: a block over budget is dropped whole and must not inflate "showing N".
        let shownInBlock = 0;
        for (const { mutant, source, uncovered } of entries) {
            if (shown + shownInBlock >= DETAIL_LIMIT) {
                truncated = true;
                break;
            }
            const diff = renderDiff(source, mutant);
            const hint = mutant.verification?.hint;
            const mark =
                (uncovered ? " · not covered by any test" : "") +
                (mutant.verification?.class === "real" ? " · confirmed by injection" : "") +
                (hint ? ` · possibly equivalent: ${hint}` : "");
            block.push(
                `**${lineLink(file, mutant.location.start.line)}** · \`${mutant.mutatorName}\`${mark}`,
            );
            block.push("");
            if (diff === null) {
                block.push(`\`→ ${String(mutant.replacement ?? "").slice(0, 120)}\``);
            } else {
                block.push("```diff");
                for (const line of diff.original) block.push(`- ${line}`);
                for (const line of diff.mutated) block.push(`+ ${line}`);
                block.push("```");
            }
            block.push("");
            shownInBlock++;
        }

        block.push("</details>");
        block.push("");

        const text = block.join("\n");
        if (shownInBlock === 0 || text.length > budget) {
            truncated = true;
            break;
        }
        budget -= text.length;
        shown += shownInBlock;
        out.push(text);
    }

    if (truncated || shown < survivors.length) {
        out.push(
            `_Showing ${shown} of ${survivors.length}. The rest are in the HTML report in the run artifacts._`,
        );
        out.push("");
        out.push("<details><summary>All files with surviving mutants</summary>");
        out.push("");
        for (const [file, entries] of sorted) out.push(`- \`${file}\` — ${entries.length}`);
        out.push("");
        out.push("</details>");
    }
}

console.log(out.join("\n"));
