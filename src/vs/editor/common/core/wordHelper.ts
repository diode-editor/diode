import type { IWordRange } from "./wordClassification.ts";

/**
 * Mirrors upstream `wordHelper.ts`. We have no per-language `wordPattern`: without an
 * extension's regex, {@link DEFAULT_WORD_REGEXP} applies.
 */

/** Upstream `createWordRegExp()` without exceptions. */
export const DEFAULT_WORD_REGEXP = /(-?\d*\.\d\w*)|([^`~!@#$%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g;

/**
 * Upstream `regExpLeadsToEndlessLoop`, but WITHOUT its allowlist (`^`, `$`, …):
 * such a regex is not a word definition, and `getWordAtText` would loop forever on it.
 * Uses a fresh copy so the caller's regex `lastIndex` stays untouched.
 */
export function regExpMatchesEmptyString(regex: RegExp): boolean {
    return new RegExp(regex.source, regex.flags).test("");
}

/**
 * Like upstream `getWordAtText`: a position right after a word is "on the word", and at a
 * junction the left word wins. Uses a fresh regex copy, so `lastIndex` carries no state between
 * calls.
 *
 * Deliberately without upstream's window and budgets (`maxLen` 1000, `windowSize` 15,
 * `timeBudget` 150 ms): they protect the UI thread, while this is called from the extension
 * host. Results differ only on lines longer than 1000 with a word longer than 500: upstream
 * cuts the word at the window edge, we return it whole.
 */
export function getWordAtText(character: number, wordDefinition: RegExp, text: string): IWordRange | null {
    const regex = new RegExp(
        wordDefinition.source,
        wordDefinition.global ? wordDefinition.flags : wordDefinition.flags + "g",
    );
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        if (match.index <= character && regex.lastIndex >= character) {
            return { start: match.index, end: regex.lastIndex };
        }
        // An empty match (`\b`, a lookahead) does not advance `lastIndex`; without
        // a manual step `exec` would return it forever.
        if (match[0].length === 0) regex.lastIndex++;
    }
    return null;
}
