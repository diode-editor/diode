import { DisplayLine } from "@tuidom/core/common/displayLine";

import type { ICoreParameterInfo, ICoreSignature } from "../../../../editor/common/languages/iSignatureHelpSource.ts";

/**
 * `start` is the chunk offset in the original label (code units): the parameter highlight can be laid
 * directly onto the wrapped lines.
 */
export interface ISignatureChunk {
    readonly text: string;
    readonly start: number;
}

/**
 * `[start, end)` in code units; `[0, 0]` means nothing to highlight. A string parameter label is
 * searched at a word boundary: a bare `indexOf` would find `name` inside `nameLength`.
 */
export function activeParameterSpan(signature: ICoreSignature, index: number): readonly [number, number] {
    // Index access yields undefined both past the end and on a negative index; `.at(index)`
    // is wrong here — it would count from the end and highlight the last parameter.
    const parameter = signature.parameters[index] as ICoreParameterInfo | undefined;
    if (parameter === undefined) return [0, 0];
    if (typeof parameter.label !== "string") {
        const [start, end] = parameter.label;
        return end > start ? [start, end] : [0, 0];
    }
    if (parameter.label === "") return [0, 0];
    const start = indexOfWithBoundary(signature.label, parameter.label);
    return start === -1 ? [0, 0] : [start, start + parameter.label.length];
}

/** The VS Code trick (`(\W|^)label(?=\W|$)`) without building a regex from a foreign string. */
function indexOfWithBoundary(haystack: string, needle: string): number {
    // The only exit is "no more occurrences": past the end of the string `indexOf`
    // returns -1 by itself, so the loop has no condition of its own.
    let from = 0;
    for (;;) {
        const index = haystack.indexOf(needle, from);
        if (index === -1) return -1;
        // `charAt` instead of indexing: past the string edges it returns an empty string,
        // which is not a word character — no ternaries with `??` needed.
        const before = haystack.charAt(index - 1);
        const after = haystack.charAt(index + needle.length);
        if (!isWordChar(before) && !isWordChar(after)) return index;
        from = index + 1;
    }
}

/** An empty string ("no neighbor") is not a word character. */
function isWordChar(char: string): boolean {
    return /\w/u.test(char);
}

/**
 * Chunks are SUBSTRINGS of the label, not reassembled text: hence a custom wrap instead of tuidom's
 * `wrapText`, which collapses spaces and loses offsets. Newlines in the label are hard breaks.
 */
export function wrapSignature(label: string, width: number): ISignatureChunk[] {
    if (width <= 0) return [];
    const chunks: ISignatureChunk[] = [];
    let base = 0;
    for (const line of label.split("\n")) {
        wrapLine(line, base, width, chunks);
        // +1 for the "\n" itself, which goes into no chunk.
        base += line.length + 1;
    }
    return chunks;
}

function wrapLine(line: string, base: number, width: number, chunks: ISignatureChunk[]): void {
    const widths = cumulativeWidths(line);
    const measure = (from: number, to: number): number => widths[to] - widths[from];
    // Bounds of the candidate line in `line` offsets; `null` means the line is not started yet.
    let lineStart: number | null = null;
    let lineEnd = 0;
    const flush = (): void => {
        if (lineStart === null) return;
        chunks.push({ text: line.slice(lineStart, lineEnd), start: base + lineStart });
        lineStart = null;
    };

    for (const word of wordsOf(line)) {
        // Take the word together with the separator before it: a chunk must be contiguous.
        // Stryker disable next-line ConditionalExpression: without a started line `measure(null, …)` yields NaN and the comparison is false anyway — the check only names the reason
        if (lineStart !== null && measure(lineStart, word.end) <= width) {
            lineEnd = word.end;
            continue;
        }
        flush();
        let cut = word.start;
        // Stryker disable next-line EqualityOperator: for a word of exactly the width both bounds give the same split — the chunk is closed either here or by the next word's flush
        while (measure(cut, word.end) > width) {
            const next = offsetAtWidth(line, widths, cut, width);
            // A character wider than the whole line (wide CJK at width 1) — advance by
            // one grapheme, otherwise the loop never terminates.
            const end = next > cut ? next : cut + 1;
            chunks.push({ text: line.slice(cut, end), start: base + cut });
            cut = end;
        }
        if (cut < word.end) {
            lineStart = cut;
            lineEnd = word.end;
        }
    }
    flush();
}

function wordsOf(line: string): { start: number; end: number }[] {
    // Stryker disable next-line ArrayDeclaration: a non-empty seed passes through the layout (a string has no `end`, and NaN comparisons are false) — it adds no chunks
    const words: { start: number; end: number }[] = [];
    let start: number | null = null;
    // Stryker disable next-line EqualityOperator: an extra iteration past the end yields an empty zero-width word that merges into the previous chunk (and on an empty line yields no chunk at all)
    for (let i = 0; i < line.length; i++) {
        const isSpace = /\s/u.test(line[i]);
        if (!isSpace && start === null) start = i;
        // Stryker disable next-line ConditionalExpression: a space without an open word yields a word with `start: null`, which passes through the layout (NaN comparisons are false, so is `null < end`) — it produces no chunks
        if (isSpace && start !== null) {
            words.push({ start, end: i });
            start = null;
        }
    }
    // Stryker disable next-line ConditionalExpression: see above — a trailing word with `start: null` likewise passes through the layout without a chunk
    if (start !== null) words.push({ start, end: line.length });
    return words;
}

/** Array length = length + 1. */
function cumulativeWidths(line: string): number[] {
    const widths = new Array<number>(line.length + 1).fill(0);
    let total = 0;
    let offset = 0;
    for (const slot of new DisplayLine(line).slots) {
        total += slot.displayWidth;
        // Inner offsets of a grapheme (surrogate pair, combining mark) get the width
        // of the whole grapheme: we never cut inside it anyway.
        for (let rest = slot.length; rest > 0; rest--) widths[++offset] = total;
    }
    return widths;
}

function offsetAtWidth(line: string, widths: readonly number[], from: number, width: number): number {
    let offset = from;
    for (const slot of new DisplayLine(line).slots) {
        // Stryker disable next-line ConditionalExpression,EqualityOperator: graphemes left of `from` give a negative width and are overwritten by the next iteration anyway — the skip saves comparisons, it does not change the split
        if (slot.offset < from) continue;
        if (widths[slot.offset + slot.length] - widths[from] > width) break;
        offset = slot.offset + slot.length;
    }
    return offset;
}
