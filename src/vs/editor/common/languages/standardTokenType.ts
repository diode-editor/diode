import { StandardTokenType as EncodedStandardTokenType } from "../encodedTokenAttributes.ts";
import type { LineTokens } from "../tokens/lineTokens.ts";

/** Стандартный вид токена (upstream `StandardTokenType`; RegEx — «прочее»). */
export type StandardTokenType = "other" | "comment" | "string";

/**
 * Вид токена, накрывающего символ `offset` строки, — `StandardTokenType` из
 * метаданных (его вычисляет vscode-textmate по скоупам: самый вложенный из
 * `comment`/`string`/`regex`/`meta.embedded`, последний сбрасывает вид в
 * «прочее» — код внутри шаблонной строки — код). Токенов нет (строка не
 * токенизирована) — «прочее».
 */
export function standardTokenTypeAt(tokens: LineTokens | undefined, offset: number): StandardTokenType {
    if (tokens === undefined) return "other";
    const type = tokens.getStandardTokenType(tokens.findTokenIndexAtOffset(offset));
    if (type === EncodedStandardTokenType.Comment) return "comment";
    if (type === EncodedStandardTokenType.String) return "string";
    return "other";
}
