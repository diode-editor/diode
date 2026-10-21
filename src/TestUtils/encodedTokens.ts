import { ColorId, FontStyle, MetadataConsts, StandardTokenType } from "../vs/editor/common/encodedTokenAttributes.ts";
import type { IState } from "../vs/editor/common/languages.ts";
import { EncodedTokenizationResult } from "../vs/editor/common/languages.ts";

export interface ITestTokenStyle {
    /** Индекс в colorMap. */
    readonly foreground?: number;
    readonly background?: number;
    readonly tokenType?: StandardTokenType;
    readonly fontStyle?: FontStyle;
}

export function tokenMetadata(style: ITestTokenStyle = {}): number {
    return (
        (((style.tokenType ?? StandardTokenType.Other) << MetadataConsts.TOKEN_TYPE_OFFSET) |
            ((style.fontStyle ?? FontStyle.None) << MetadataConsts.FONT_STYLE_OFFSET) |
            ((style.foreground ?? ColorId.DefaultForeground) << MetadataConsts.FOREGROUND_OFFSET) |
            ((style.background ?? ColorId.DefaultBackground) << MetadataConsts.BACKGROUND_OFFSET)) >>>
        0
    );
}

/** Метка «какой токенизатор/проход положил токен»; читать — `lineTokens.getForeground(i)`. */
export function markedMetadata(n: number): number {
    return tokenMetadata({ foreground: n });
}

/** Формат `tokenizeEncoded` — начала токенов. */
export function encodeTokens(tokens: readonly (readonly [startIndex: number, metadata: number])[]): Uint32Array {
    return new Uint32Array(tokens.flat());
}

export function encodedResult(
    tokens: readonly (readonly [startIndex: number, metadata: number])[],
    endState: IState,
): EncodedTokenizationResult {
    return new EncodedTokenizationResult(encodeTokens(tokens), [], endState);
}

/** Формат хранения (`LineTokens`) — концы токенов, а не начала. */
export function storedTokens(
    tokens: readonly (readonly [startIndex: number, metadata: number])[],
    lineLength: number,
): Uint32Array {
    const result = new Uint32Array(tokens.length * 2);
    tokens.forEach(([, metadata], i) => {
        result[i * 2] = i + 1 < tokens.length ? tokens[i + 1][0] : lineLength;
        result[i * 2 + 1] = metadata;
    });
    return result;
}
