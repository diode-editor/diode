import { DEFAULT_WORD_REGEXP, getWordAtText } from "../../../../editor/common/core/wordHelper.ts";
import type { StandardTokenType } from "../../../../editor/common/languages/standardTokenType.ts";

// Mirrors upstream `EditorQuickSuggestions`, `QuickSuggestionsOptions` and `LineContext.shouldAutoTrigger`.

export type QuickSuggestionsValue = "on" | "inline" | "off" | "offWhenInlineCompletions";

export interface IQuickSuggestionsOptions {
    readonly other: QuickSuggestionsValue;
    readonly comments: QuickSuggestionsValue;
    readonly strings: QuickSuggestionsValue;
}

const QUICK_SUGGESTIONS_VALUES: readonly QuickSuggestionsValue[] = ["on", "inline", "off", "offWhenInlineCompletions"];

export const QUICK_SUGGESTIONS_DEFAULT: IQuickSuggestionsOptions = {
    other: "offWhenInlineCompletions",
    comments: "off",
    strings: "off",
};

/** upstream `EditorQuickSuggestions.validate`: missing and garbage values give the default. */
export function readQuickSuggestions(input: unknown): IQuickSuggestionsOptions {
    if (typeof input === "boolean") {
        const value = input ? "on" : "off";
        return { other: value, comments: value, strings: value };
    }
    if (typeof input === "string") {
        const value = toValue(input, QUICK_SUGGESTIONS_DEFAULT.other);
        return { other: value, comments: value, strings: value };
    }
    if (typeof input !== "object" || input === null) return QUICK_SUGGESTIONS_DEFAULT;
    const { other, comments, strings } = input as Readonly<Record<string, unknown>>;
    return {
        other: toValue(other, QUICK_SUGGESTIONS_DEFAULT.other),
        comments: toValue(comments, QUICK_SUGGESTIONS_DEFAULT.comments),
        strings: toValue(strings, QUICK_SUGGESTIONS_DEFAULT.strings),
    };
}

function toValue(input: unknown, fallback: QuickSuggestionsValue): QuickSuggestionsValue {
    if (typeof input === "boolean") return input ? "on" : "off";
    return QUICK_SUGGESTIONS_VALUES.find((value) => value === input) ?? fallback;
}

export function valueFor(config: IQuickSuggestionsOptions, tokenType: StandardTokenType): QuickSuggestionsValue {
    switch (tokenType) {
        case "comment":
            return config.comments;
        case "string":
            return config.strings;
        default:
            return config.other;
    }
}

/**
 * upstream `LineContext.shouldAutoTrigger`: the cursor is at the end of a word (or past its first character —
 * a letter before a word), and the word is not a number. `.` and `-` break a word: `foo.` and `a -` don't open the popup.
 */
export function shouldAutoTrigger(line: string, character: number): boolean {
    const word = getWordAtText(character, DEFAULT_WORD_REGEXP, line);
    if (word === null) return false;
    if (word.end !== character && word.start + 1 !== character) return false;
    return Number.isNaN(Number(line.slice(word.start, word.end)));
}
