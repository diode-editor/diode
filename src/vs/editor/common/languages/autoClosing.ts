import type { CharacterPair } from "../../../platform/extensions/common/iLanguageConfiguration.ts";
import { isWordChar } from "../core/wordClassification.ts";

import type { IResolvedAutoClosingPair } from "./languageConfiguration.ts";

/**
 * Авто-закрытие пар при наборе (VS Code `autoClosingPairs` /
 * `autoCloseBefore` / `surroundingPairs`) — чистый планировщик решений.
 * Скобки и кавычки описывает language configuration активного языка;
 * применяет решения `EditorViewState`, а склейку смотри в
 * `EditorElement.handleKeyPress`.
 *
 * Упрощения v1 (осознанные, в духе `autoIndent.ts`):
 *  - `notIn: string/comment` не учитывается — у планировщика нет токенов;
 *    вместо него у симметричных пар (кавычек) базовый контекст: не удваивать
 *    кавычку после символа слова или той же кавычки (`don't` не даёт `don''t`);
 *  - typeover закрывающей срабатывает по совпадению следующего символа, без
 *    отслеживания «этот символ вставили мы» (VS Code `autoClosingOvertype:
 *    "auto"` строже: перепрыгивает только свои).
 */

export type AutoCloseDecision =
    | { readonly kind: "typeover" }
    | { readonly kind: "autoClose"; readonly close: string }
    | { readonly kind: "plain" };

export interface IAutoClosePlanParams {
    /** Печатаемый символ (ровно один). */
    readonly typedChar: string;
    /** Строка каретки и её колонка. */
    readonly lineContent: string;
    readonly column: number;
    readonly autoClosingPairs: readonly IResolvedAutoClosingPair[];
    /** Символы, перед которыми пара закрывается (плюс конец строки). */
    readonly autoCloseBefore: string;
}

/** Решение для ОДНОЙ схлопнутой каретки. */
export function planAutoClose(params: IAutoClosePlanParams): AutoCloseDecision {
    const { typedChar, lineContent, column, autoClosingPairs, autoCloseBefore } = params;
    // За концом строки индекс даёт undefined — это и есть «дальше пусто».
    const next = lineContent.at(column);

    // Набранная закрывающая уже стоит под кареткой — перепрыгиваем, не плодя `))`.
    if (next === typedChar && autoClosingPairs.some((pair) => pair.close === typedChar)) {
        return { kind: "typeover" };
    }

    // Пара может открываться и несколькими символами (`/**` → ` */`): матчим
    // хвост «текст до каретки + набранный символ», предпочитая самый длинный.
    const textWithChar = lineContent.slice(0, column) + typedChar;
    let matched: IResolvedAutoClosingPair | undefined;
    for (const pair of autoClosingPairs) {
        if (!pair.open.endsWith(typedChar) || !textWithChar.endsWith(pair.open)) continue;
        if (matched === undefined || pair.open.length > matched.open.length) matched = pair;
    }
    if (matched === undefined) return { kind: "plain" };

    // Закрываем только перед «пустотой»: концом строки или символом из
    // autoCloseBefore — иначе скобка, набранная посреди слова, дописала бы пару.
    if (next !== undefined && !autoCloseBefore.includes(next)) return { kind: "plain" };

    // Симметричная пара (кавычка): после символа слова или той же кавычки не
    // удваиваем — это набор апострофа в тексте, а не открытие строки.
    if (matched.open === matched.close && matched.open.length === 1) {
        // В начале строки слева ничего нет — пара открывается: чтение по индексу −1
        // даёт undefined (`.at(-1)` здесь нельзя — он отдал бы последний символ).
        const prev = lineContent[column - 1] as string | undefined;
        if (prev !== undefined && (isWordChar(prev) || prev === typedChar)) return { kind: "plain" };
    }

    return { kind: "autoClose", close: matched.close };
}

/** Пара обрамления для набранного символа: открывающая совпадает с ним. */
export function findSurroundingPair(
    typedChar: string,
    surroundingPairs: readonly CharacterPair[],
): CharacterPair | undefined {
    return surroundingPairs.find((pair) => pair[0] === typedChar);
}
