import { DEFAULT_WORD_REGEXP, getWordAtText } from "../../../../editor/common/core/wordHelper.ts";
import type { ILineTokens } from "../../../../editor/common/languages/iLineTokens.ts";

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

/** Стандартный вид токена (upstream `StandardTokenType`; RegEx для настройки — «прочее»). */
export type StandardTokenType = "other" | "comment" | "string";

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
 * Скоупы, задающие стандартный вид токена, — `STANDARD_TOKEN_TYPE_REGEXP`
 * vscode-textmate (`BasicScopeAttributesProvider`): `meta.embedded` сбрасывает
 * вид обратно в «прочее» (код внутри шаблонной строки — код).
 */
const STANDARD_TOKEN_TYPE_REGEXP = /\b(comment|string|regex|meta\.embedded)\b/;

/**
 * Вид токена, накрывающего символ `offset` строки. Как у vscode-textmate,
 * побеждает самый вложенный скоуп с совпадением. Токенов нет (строка не
 * токенизирована, язык без грамматики) — «прочее».
 */
export function standardTokenTypeAt(tokens: ILineTokens | undefined, offset: number): StandardTokenType {
    if (tokens === undefined) return "other";
    const token = tokens.tokens.findLast((candidate) => candidate.startIndex <= offset);
    if (token === undefined) return "other";
    let type: StandardTokenType = "other";
    for (const scope of token.scopes) {
        const match = STANDARD_TOKEN_TYPE_REGEXP.exec(scope);
        if (match === null) continue;
        type = match[1] === "comment" ? "comment" : match[1] === "string" ? "string" : "other";
    }
    return type;
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
