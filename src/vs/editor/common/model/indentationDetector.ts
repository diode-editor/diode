import { CharCode } from "../../../base/common/charCode.ts";

import type { ITextDocument } from "./iTextDocument.ts";

// The linter forbids comparing number against enum CharCode (no-unsafe-enum-comparison).
const SPACE: number = CharCode.Space;
const TAB: number = CharCode.Tab;
const COMMA: number = CharCode.Comma;

export interface DetectedIndentation {
    readonly insertSpaces: boolean;
    readonly tabSize: number;
}

/** What the file does not tell: no indentation, a tabs/spaces tie, tab width for tab indentation. */
export interface IIndentationDefaults {
    readonly tabSize: number;
    readonly insertSpaces: boolean;
}

const MAX_SCAN_LINES = 10000;
const MAX_TAB_SIZE_GUESS = 8;
/** Probe order: on equal score the earlier candidate wins. */
const TAB_SIZE_GUESSES = [2, 4, 6, 8, 3, 5, 7];

export interface IIndentationStep {
    /** 0 means no step or an unusable signal. */
    readonly step: number;
    /** The line is not indented but aligned to the previous line's content. */
    readonly looksLikeAlignment: boolean;
}

const NO_STEP: IIndentationStep = { step: 0, looksLikeAlignment: false };

/**
 * The DIFFERENCE between adjacent lines, not absolute widths: with indent 4 the levels
 * are 4, 8, 12, and the most frequent width is not the step. `aIndent`/`bIndent` are indent lengths.
 */
export function computeIndentationStep(a: string, aIndent: number, b: string, bIndent: number): IIndentationStep {
    // Stryker disable next-line MethodExpression: min and max are indistinguishable here:
    // past the shorter indent one line has a non-whitespace char and the other a space
    // or tab, so the loop stops at min anyway.
    const common = Math.min(aIndent, bIndent);
    let i = 0;
    // Stryker disable next-line EqualityOperator: the extra iteration is unobservable: it
    // goes past the indent of at least one line, and the counters below are bounded by
    // that indent and count nothing.
    for (; i < common; i++) {
        if (a.charCodeAt(i) !== b.charCodeAt(i)) break;
    }

    let aSpaces = 0;
    let aTabs = 0;
    for (let j = i; j < aIndent; j++) {
        if (a.charCodeAt(j) === SPACE) aSpaces++;
        else aTabs++;
    }
    let bSpaces = 0;
    let bTabs = 0;
    for (let j = i; j < bIndent; j++) {
        if (b.charCodeAt(j) === SPACE) bSpaces++;
        else bTabs++;
    }

    // A mixed tail (both tabs and spaces) gives nothing to compare the difference to.
    if (aSpaces > 0 && aTabs > 0) return NO_STEP;
    if (bSpaces > 0 && bTabs > 0) return NO_STEP;

    // A sum, not an absolute difference: past the common prefix the tails are uniform,
    // and in each pair one of the terms is always zero.
    const tabsDiff = aTabs + bTabs;
    const spacesDiff = aSpaces + bSpaces;

    if (tabsDiff === 0) {
        // A continuation aligned to a char of the previous line (`foo(a,` → `    b`) is
        // not indentation. No "step is non-zero" check needed: with `bSpaces === 0`
        // reading `a` at index -1 yields NaN.
        const looksLikeAlignment =
            b.charCodeAt(bSpaces) !== SPACE &&
            a.charCodeAt(bSpaces - 1) === SPACE &&
            a.charCodeAt(a.length - 1) === COMMA;
        return { step: spacesDiff, looksLikeAlignment };
    }
    // Tabs on one line, spaces on the other: the signal is usable only if the spaces
    // divide evenly by the number of "consumed" tabs; then that is the tab width.
    if (spacesDiff % tabsDiff !== 0) return NO_STEP;
    return { step: spacesDiff / tabsDiff, looksLikeAlignment: false };
}

export function detectIndentation(document: ITextDocument, defaults: IIndentationDefaults): DetectedIndentation {
    const lineCount = Math.min(document.lineCount, MAX_SCAN_LINES);

    let tabIndentedLines = 0;
    let spaceIndentedLines = 0;
    // Indexed by step size. A typed array for its fixed size: writing a step above 8 is
    // silently dropped, no separate check needed.
    const diffCounts = new Int32Array(MAX_TAB_SIZE_GUESS + 1);

    // Stryker disable next-line StringLiteral: the seed text is unobservable: with zero
    // indent only its last char is read by the alignment check, which needs both a
    // trailing comma and a space under the next line's first non-whitespace char; no
    // seed literal can satisfy both at once.
    let previousLineText = "";
    let previousLineIndent = 0;

    for (let i = 0; i < lineCount; i++) {
        const lineText = document.getLineContent(i);
        let spaces = 0;
        let tabs = 0;
        let indent = -1;
        for (let j = 0; j < lineText.length; j++) {
            const charCode = lineText.charCodeAt(j);
            if (charCode === TAB) tabs++;
            else if (charCode === SPACE) spaces++;
            else {
                indent = j;
                break;
            }
        }
        // Whitespace-only lines do not reset the previous one: indent is compared across them.
        if (indent === -1) continue;

        if (tabs > 0) tabIndentedLines++;
        // Exactly one leading space is a `*` in a block comment, not indentation.
        else if (spaces > 1) spaceIndentedLines++;

        const diff = computeIndentationStep(previousLineText, previousLineIndent, lineText, indent);
        // Nor a base for the next line, or it would skew that line's step too.
        if (diff.looksLikeAlignment) continue;
        diffCounts[diff.step]++;

        previousLineText = lineText;
        previousLineIndent = indent;
    }

    let insertSpaces = defaults.insertSpaces;
    if (spaceIndentedLines > tabIndentedLines) insertSpaces = true;
    else if (tabIndentedLines > spaceIndentedLines) insertSpaces = false;

    // Tab width is a view property, not a file one: tab indentation says nothing about it.
    if (!insertSpaces) return { insertSpaces, tabSize: defaults.tabSize };

    let tabSize = defaults.tabSize;
    let bestScore = 0;
    for (const guess of TAB_SIZE_GUESSES) {
        if (diffCounts[guess] > bestScore) {
            bestScore = diffCounts[guess];
            tabSize = guess;
        }
    }
    // With indent 2, step 4 shows up on every double jump and can outscore 2.
    if (tabSize === 4 && diffCounts[4] > 0 && diffCounts[2] >= diffCounts[4] / 2) tabSize = 2;

    return { insertSpaces, tabSize };
}
