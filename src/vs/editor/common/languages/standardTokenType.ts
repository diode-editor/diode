import { StandardTokenType as EncodedStandardTokenType } from "../encodedTokenAttributes.ts";
import type { LineTokens } from "../tokens/lineTokens.ts";

/** upstream `StandardTokenType`; RegEx — «прочее». */
export type StandardTokenType = "other" | "comment" | "string";

/**
 * vscode-textmate берёт самый вложенный из `comment`/`string`/`regex`/
 * `meta.embedded`; последний сбрасывает вид в «прочее» — код внутри шаблонной
 * строки — код.
 */
export function standardTokenTypeAt(tokens: LineTokens | undefined, offset: number): StandardTokenType {
    if (tokens === undefined) return "other";
    const type = tokens.getStandardTokenType(tokens.findTokenIndexAtOffset(offset));
    if (type === EncodedStandardTokenType.Comment) return "comment";
    if (type === EncodedStandardTokenType.String) return "string";
    return "other";
}
