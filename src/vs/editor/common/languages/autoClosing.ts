import type { CharacterPair } from "../../../platform/extensions/common/iLanguageConfiguration.ts";
import { isWordChar } from "../core/wordClassification.ts";

import type { IResolvedAutoClosingPair } from "./languageConfiguration.ts";

/**
 * Осознанные упрощения против VS Code:
 *  - `notIn: string/comment` не учитывается — у планировщика нет токенов;
 *    вместо него кавычка не удваивается после символа слова или той же кавычки
 *    (`don't` не даёт `don''t`);
 *  - typeover срабатывает по совпадению следующего символа, без отслеживания
 *    «этот символ вставили мы» (`autoClosingOvertype: "auto"` строже).
 */

export type AutoCloseDecision =
    | { readonly kind: "typeover" }
    | { readonly kind: "autoClose"; readonly close: string }
    | { readonly kind: "plain" };

export interface IAutoClosePlanParams {
    /** Ровно один символ. */
    readonly typedChar: string;
    readonly lineContent: string;
    readonly column: number;
    readonly autoClosingPairs: readonly IResolvedAutoClosingPair[];
    readonly autoCloseBefore: string;
}

/** Для ОДНОЙ схлопнутой каретки. */
export function planAutoClose(params: IAutoClosePlanParams): AutoCloseDecision {
    const { typedChar, lineContent, column, autoClosingPairs, autoCloseBefore } = params;
    const next = lineContent.at(column);

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

    if (next !== undefined && !autoCloseBefore.includes(next)) return { kind: "plain" };

    if (matched.open === matched.close && matched.open.length === 1) {
        // Индекс −1 даёт undefined; `.at(-1)` здесь нельзя — он отдал бы последний символ.
        const prev = lineContent[column - 1] as string | undefined;
        if (prev !== undefined && (isWordChar(prev) || prev === typedChar)) return { kind: "plain" };
    }

    return { kind: "autoClose", close: matched.close };
}

export function findSurroundingPair(
    typedChar: string,
    surroundingPairs: readonly CharacterPair[],
): CharacterPair | undefined {
    return surroundingPairs.find((pair) => pair[0] === typedChar);
}
