import type { CharacterPair } from "../../../platform/extensions/common/iLanguageConfiguration.ts";
import { isWordChar } from "../core/wordClassification.ts";

import type { IResolvedAutoClosingPair } from "./languageConfiguration.ts";

/**
 * Deliberate simplifications compared to VS Code:
 *  - `notIn: string/comment` is ignored since the planner has no tokens; instead a quote
 *    is not doubled after a word character or the same quote (`don't` does not become
 *    `don''t`);
 *  - typeover fires when the next character matches, without tracking "we inserted this
 *    character" (`autoClosingOvertype: "auto"` is stricter).
 */

export type AutoCloseDecision =
    | { readonly kind: "typeover" }
    | { readonly kind: "autoClose"; readonly close: string }
    | { readonly kind: "plain" };

export interface IAutoClosePlanParams {
    /** Exactly one character. */
    readonly typedChar: string;
    readonly lineContent: string;
    readonly column: number;
    readonly autoClosingPairs: readonly IResolvedAutoClosingPair[];
    readonly autoCloseBefore: string;
}

/** For ONE collapsed cursor. */
export function planAutoClose(params: IAutoClosePlanParams): AutoCloseDecision {
    const { typedChar, lineContent, column, autoClosingPairs, autoCloseBefore } = params;
    const next = lineContent.at(column);

    if (next === typedChar && autoClosingPairs.some((pair) => pair.close === typedChar)) {
        return { kind: "typeover" };
    }

    // A pair may open with several characters (`/**` → ` */`): match the tail of
    // "text before the cursor + typed character", preferring the longest.
    const textWithChar = lineContent.slice(0, column) + typedChar;
    let matched: IResolvedAutoClosingPair | undefined;
    for (const pair of autoClosingPairs) {
        if (!pair.open.endsWith(typedChar) || !textWithChar.endsWith(pair.open)) continue;
        if (matched === undefined || pair.open.length > matched.open.length) matched = pair;
    }
    if (matched === undefined) return { kind: "plain" };

    if (next !== undefined && !autoCloseBefore.includes(next)) return { kind: "plain" };

    if (matched.open === matched.close && matched.open.length === 1) {
        // Index −1 yields undefined; `.at(-1)` won't do here, it would return the last character.
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
