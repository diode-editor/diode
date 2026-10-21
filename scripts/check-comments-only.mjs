#!/usr/bin/env node
/**
 * Gate for comments-only changes (comment cleanup, docs/STYLE.md#комментарии): compares every
 * file changed against the base and fails if the change touched anything but comments. Code is
 * compared as a token stream without comments (scripts/code-tokens.mjs), so whitespace, line
 * breaks, removed lines and a literal prettier collapsed don't matter while any token change shows.
 * Service markers (Stryker, c8/v8, eslint, TODO, …) must survive in the same number: they are not
 * explanations but instructions to tools and people.
 * With --no-cyrillic (translating comments to English) the comments of every changed file must
 * also be free of Cyrillic.
 *
 *   node scripts/check-comments-only.mjs [base=origin/main] [--no-cyrillic] [-- paths…]
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

import { hasCyrillic } from "./check-cyrillic.mjs";
import { codeTokens, firstDifference, isVendored, kindOf } from "./code-tokens.mjs";

const CODE = /\.(?:[cm]?[jt]s|tsx)$/;
// A marker is a directive, not a mention: it counts only at the start of a comment line
// (after `//`, `/*`, `*` and `──` decoration). Otherwise trimming prose like "markers (Stryker, TODO, …)"
// or `` `/* v8 ignore */` `` in a JSDoc fails the gate though no directive was lost.
const MARKERS = [
    /^Stryker (?:disable|restore)/,
    /^(?:[cv]8|istanbul) ignore/,
    /^eslint-(?:disable|enable)/,
    /^prettier-ignore/,
    /^@ts-(?:expect-error|ignore|nocheck)/,
    /^@deprecated/,
    /^@vitest-environment/,
    /^@diode:/,
    /^(?:TODO|FIXME|HACK|XXX)\b/,
];
const FILE_MARKERS = [/^\/\/\/ <reference/gm, /^#!/g];
const FROZEN = [/\/vscode\.d\.ts$/, /\/vscode-dts\//];

// Walks getChildren, not forEachChild: the latter doesn't see tokens, and a comment
// before the `}` of an empty block (`catch { /* c8 ignore next */ }`) would be lost.
function commentLines(path, text) {
    const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kindOf(path));
    const seen = new Set();
    const lines = [];
    const take = (ranges) => {
        for (const r of ranges ?? []) {
            if (seen.has(r.pos)) continue;
            seen.add(r.pos);
            const body = text
                .slice(r.pos, r.end)
                .replace(/^\/[/*]/, "")
                .replace(/\*\/$/, "");
            for (const line of body.split("\n")) lines.push(line.replace(/^[\s*─—–-]*/, ""));
        }
    };
    const visit = (node) => {
        take(ts.getLeadingCommentRanges(text, node.getFullStart()));
        take(ts.getTrailingCommentRanges(text, node.getEnd()));
        for (const child of node.getChildren(sf)) visit(child);
    };
    visit(sf);
    return lines;
}

function markerCounts(path, text) {
    const lines = commentLines(path, text);
    return [
        ...MARKERS.map((re) => [re.source, lines.filter((l) => re.test(l)).length]),
        ...FILE_MARKERS.map((re) => [re.source, text.match(re)?.length ?? 0]),
    ];
}

/** Problems of one changed file; `before` is its text at the base. */
export function checkFile(path, before, after, { noCyrillic = false } = {}) {
    if (isVendored(before) || FROZEN.some((r) => r.test(path))) return [`${path}: verbatim upstream copy — not edited by hand`];
    const problems = [];
    const diff = firstDifference(codeTokens(path, before), codeTokens(path, after));
    if (diff !== null) {
        const where = diff.after ? `line ${diff.after.start}, \`${diff.after.text}\`` : "end of file";
        problems.push(`${path}: code changed, not only comments (${where})`);
    }
    const now = markerCounts(path, after);
    for (const [i, [marker, was]] of markerCounts(path, before).entries()) {
        if (was !== now[i][1]) problems.push(`${path}: marker ${marker} — was ${was}, now ${now[i][1]}`);
    }
    if (noCyrillic) {
        const left = commentLines(path, after).filter(hasCyrillic);
        if (left.length > 0)
            problems.push(`${path}: ${left.length} comment lines still in Russian, e.g. "${left[0].trim()}"`);
    }
    return problems;
}

function main() {
    const noCyrillic = process.argv.includes("--no-cyrillic");
    const args = process.argv.slice(2).filter((a) => a !== "--no-cyrillic");
    const sep = args.indexOf("--");
    const base = (sep < 0 ? args : args.slice(0, sep))[0] ?? "origin/main";
    const only = sep < 0 ? [] : args.slice(sep + 1);

    const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28 });
    const changed = git("diff", "--name-only", "--diff-filter=M", base, "--", ...only)
        .split("\n")
        .filter((f) => CODE.test(f));
    const removed = git("diff", "--name-only", "--diff-filter=DR", base, "--", ...only)
        .split("\n")
        .filter(Boolean);

    const problems = removed.map((f) => `${f}: file deleted/renamed — a comments-only change doesn't do that`);
    for (const f of changed) {
        problems.push(...checkFile(f, git("show", `${base}:${f}`), readFileSync(f, "utf8"), { noCyrillic }));
    }

    for (const p of problems) console.error(p);
    console.log(`check-comments-only: ${changed.length} files, ${problems.length} problems`);
    return problems.length === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
