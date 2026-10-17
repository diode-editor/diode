import { DEFAULT_WORD_REGEXP, getWordAtText } from "../../../../editor/common/core/wordHelper.ts";
import type { StandardTokenType } from "../../../../editor/common/languages/standardTokenType.ts";

/**
 * Авто-открытие suggest при наборе («quick suggestions») — калька upstream:
 * `EditorQuickSuggestions` (`editor/common/config/editorOptions.ts`),
 * `QuickSuggestionsOptions` (`editor/contrib/suggest/browser/suggest.ts`) и
 * `LineContext.shouldAutoTrigger` (`suggestModel.ts`).
 */

/** Режим для одного вида токенов (значения `editor.quickSuggestions` эталона). */
export type QuickSuggestionsValue = "on" | "inline" | "off" | "offWhenInlineCompletions";

/** Нормализованная настройка: режим на каждый вид токенов. */
export interface IQuickSuggestionsOptions {
    readonly other: QuickSuggestionsValue;
    readonly comments: QuickSuggestionsValue;
    readonly strings: QuickSuggestionsValue;
}

const QUICK_SUGGESTIONS_VALUES: readonly QuickSuggestionsValue[] = ["on", "inline", "off", "offWhenInlineCompletions"];

/** Дефолт эталона: в коде — пока нет призрачных подсказок, в комментариях и строках — нет. */
export const QUICK_SUGGESTIONS_DEFAULT: IQuickSuggestionsOptions = {
    other: "offWhenInlineCompletions",
    comments: "off",
    strings: "off",
};

/**
 * Значение `editor.quickSuggestions` → режим по видам токенов (upstream
 * `EditorQuickSuggestions.validate`): `true`/`false` — всё вкл/выкл, строка —
 * один режим на все виды, объект — по полям; недостающее и мусор — дефолт.
 */
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

/** Режим для вида токена (upstream `QuickSuggestionsOptions.valueFor`). */
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
 * Стоит ли авто-открывать suggest при каретке `character` в строке `line`
 * (upstream `LineContext.shouldAutoTrigger`): под кареткой слово, каретка в его
 * конце (или сразу за первым символом — набор буквы перед словом), и слово —
 * не число. Слово — по дефолтному определению эталона: `.` и `-` его рвут,
 * так что `foo.` и `a -` попап не открывают, а `42` и `1.5` — тоже.
 */
export function shouldAutoTrigger(line: string, character: number): boolean {
    const word = getWordAtText(character, DEFAULT_WORD_REGEXP, line);
    if (word === null) return false;
    if (word.end !== character && word.start + 1 !== character) return false;
    return Number.isNaN(Number(line.slice(word.start, word.end)));
}
