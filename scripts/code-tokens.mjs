/**
 * Code of a file as a token stream without comments and layout: what is left of a change once
 * comments, whitespace and line breaks are set aside. Shared by the comments-only gate
 * (scripts/check-comments-only.mjs) and the mutation scope (scripts/mutation-diff.mjs).
 *
 * Tokens, not the AST reprinted by the TS printer: the printer keeps `multiLine` of literals
 * and blocks, so a literal prettier collapsed onto one line after a comment was removed
 * reprints differently, though no token changed. A separator before a closing bracket
 * (`[a, b,]`, `{ a: string; }`) is dropped for the same reason: prettier adds it to a
 * multi-line literal and removes it from a one-line one.
 */

import ts from "typescript";

const CLOSERS = new Set([")", "]", "}"]);
const SEPARATORS = new Set([",", ";"]);
const BANNER = "//@diode:vendored ";

export const kindOf = (path) =>
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;

/** `{ text, start, end }`, lines are 1-based; `end` is the last line of a multi-line token. */
export function codeTokens(path, text) {
    const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kindOf(path));
    const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
    const raw = [];
    const visit = (node) => {
        if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
        const children = node.getChildren(sf);
        if (children.length > 0) {
            for (const child of children) visit(child);
            return;
        }
        const start = node.getStart(sf);
        if (start === node.end) return;
        raw.push({ text: text.slice(start, node.end), start: lineOf(start), end: lineOf(node.end) });
    };
    visit(sf);
    // `[,]` keeps its comma: it is an elision, not a trailing separator.
    return raw.filter(
        (t, i) => !(SEPARATORS.has(t.text) && CLOSERS.has(raw[i + 1]?.text) && !["[", ","].includes(raw[i - 1]?.text)),
    );
}

export function sameCode(a, b) {
    return a.length === b.length && a.every((t, i) => t.text === b[i].text);
}

/** The first token where the streams diverge, `null` when the code is the same. */
export function firstDifference(before, after) {
    const n = Math.min(before.length, after.length);
    for (let i = 0; i < n; i++) if (before[i].text !== after[i].text) return { before: before[i], after: after[i] };
    return before.length === after.length ? null : { before: before[n] ?? null, after: after[n] ?? null };
}

/**
 * A verbatim upstream copy: `scripts/import-vscode-editor.mjs` puts the banner into the leading
 * comments of the file, right after the MIT header. Only there: the importer itself holds the
 * banner as a string literal and is not a vendored file.
 */
export function isVendored(text) {
    const shebang = ts.getShebang(text)?.length ?? 0;
    return (ts.getLeadingCommentRanges(text, shebang) ?? []).some((r) => text.startsWith(BANNER, r.pos));
}

/** Above this many cells the LCS table is not worth building: the hunk stays whole. */
const LCS_LIMIT = 4_000_000;

const overlapping = (tokens, start, end) => tokens.filter((t) => t.start <= end && t.end >= start);

/**
 * Lines `lo..hi` of the new side that hold a changed token. A deleted token marks the lines of
 * its kept neighbours, so `a && b` → `a` stays in scope though every token left on it is old.
 */
function changedLines(before, after, lo, hi) {
    const lines = new Set();
    const mark = (t) => {
        for (let l = Math.max(t.start, lo); l <= Math.min(t.end, hi); l++) lines.add(l);
    };
    const n = before.length;
    const m = after.length;
    if (n * m > LCS_LIMIT) {
        for (let l = lo; l <= hi; l++) lines.add(l);
        return lines;
    }
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            lcs[i * w + j] =
                before[i].text === after[j].text ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
        }
    }
    let i = 0;
    let j = 0;
    let deleted = false;
    const flushDeleted = () => {
        if (!deleted) return;
        if (j > 0) mark(after[j - 1]);
        if (j < m) mark(after[j]);
        deleted = false;
    };
    while (i < n || j < m) {
        if (i < n && j < m && before[i].text === after[j].text) {
            flushDeleted();
            i++;
            j++;
        } else if (j < m && (i === n || lcs[i * w + j + 1] >= lcs[(i + 1) * w + j])) {
            mark(after[j++]);
        } else {
            deleted = true;
            i++;
        }
    }
    flushDeleted();
    return lines;
}

/**
 * Of the hunks of a `git diff -U0` (`{ oldStart, oldCount, newStart, newCount }`), the new-side
 * line ranges where the code changed. A line where only a comment changed, or prettier only
 * moved tokens, drops out: the mutation gate would otherwise drag in old survivors of a line
 * that merely lost its trailing comment.
 */
export function changedCodeRanges(path, before, after, hunks) {
    const oldTokens = codeTokens(path, before);
    const newTokens = codeTokens(path, after);
    const lines = new Set();
    for (const h of hunks) {
        if (h.newCount === 0) continue;
        const hi = h.newStart + h.newCount - 1;
        const was = overlapping(oldTokens, h.oldStart, h.oldStart + h.oldCount - 1);
        const now = overlapping(newTokens, h.newStart, hi);
        for (const line of changedLines(was, now, h.newStart, hi)) lines.add(line);
    }
    const ranges = [];
    for (const line of [...lines].sort((a, b) => a - b)) {
        const last = ranges[ranges.length - 1];
        if (last && line === last[1] + 1) last[1] = line;
        else ranges.push([line, line]);
    }
    return ranges;
}
