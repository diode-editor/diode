/** VS Code `editor.wordSeparators` plus whitespace. */
export const WORD_SEPARATORS = new Set(" \t\r\n`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?");

/** 0 = whitespace, 1 = punctuation/separator, 2 = word character. */
export function charClass(ch: string): number {
    if (ch === " " || ch === "\t") return 0;
    if (WORD_SEPARATORS.has(ch)) return 1;
    return 2;
}

/** An empty string (line boundary) is not a word character. */
export function isWordChar(ch: string): boolean {
    return ch.length === 1 && charClass(ch) === 2;
}

/** `[start, end)`. */
export interface IWordRange {
    readonly start: number;
    readonly end: number;
}

/** Like VS Code `getWordAtPosition`: a cursor right AFTER a word (`foo|`) is also on the word. */
export function findWordRangeAt(line: string, character: number): IWordRange | null {
    const len = line.length;
    // A position one frame stale would crash the WHOLE editor: occurrence highlighting is
    // called from render, and nothing catches exceptions there. The clamp is like
    // `validatePosition` in vscode.
    const caret = Math.max(0, Math.min(Math.trunc(character), len));
    let anchor: number;
    if (caret < len && isWordChar(line[caret])) {
        anchor = caret;
    } else if (caret > 0 && isWordChar(line[caret - 1])) {
        anchor = caret - 1;
    } else {
        return null;
    }

    let start = anchor;
    while (start > 0 && isWordChar(line[start - 1])) start--;
    let end = anchor + 1;
    while (end < len && isWordChar(line[end])) end++;
    return { start, end };
}
