import type { ILineTokens } from "./iLineTokens.ts";

/** Стандартный вид токена (upstream `StandardTokenType`; RegEx — «прочее»). */
export type StandardTokenType = "other" | "comment" | "string";

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
