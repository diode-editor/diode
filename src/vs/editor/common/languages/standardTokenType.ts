import { StandardTokenType as EncodedStandardTokenType } from "../encodedTokenAttributes.ts";
import type { LineTokens } from "../tokens/lineTokens.ts";

/** upstream `StandardTokenType`; RegEx counts as "other". */
export type StandardTokenType = "other" | "comment" | "string";

/**
 * Like vscode-textmate, takes the innermost of `comment`/`string`/`regex`/`meta.embedded`;
 * the last one resets the type to "other", since code inside a template string is code.
 */
export function standardTokenTypeAt(tokens: LineTokens | undefined, offset: number): StandardTokenType {
    if (tokens === undefined) return "other";
    const type = tokens.getStandardTokenType(tokens.findTokenIndexAtOffset(offset));
    if (type === EncodedStandardTokenType.Comment) return "comment";
    if (type === EncodedStandardTokenType.String) return "string";
    return "other";
}
