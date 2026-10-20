/**
 * Бинарные токены для тестов (формат эталона, `editor/common/encodedTokenAttributes.ts`):
 * метаданные из понятных полей и результат токенизатора из пар «начало +
 * метаданные». Тестам, которым важен лишь «какой это токен», удобно метить
 * токен индексом цвета: `tokenMetadata({ foreground: 7 })`, а читать —
 * `lineTokens.getForeground(i)`.
 */
import { ColorId, FontStyle, MetadataConsts, StandardTokenType } from "../vs/editor/common/encodedTokenAttributes.ts";
import type { IState } from "../vs/editor/common/languages.ts";
import { EncodedTokenizationResult } from "../vs/editor/common/languages.ts";

export interface ITestTokenStyle {
    /** Индекс цвета текста в colorMap; по умолчанию `ColorId.DefaultForeground`. */
    readonly foreground?: number;
    /** Индекс цвета фона; по умолчанию `ColorId.DefaultBackground`. */
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

/** Токен, помеченный индексом цвета `n` (для тестов «какой токенизатор/проход его положил»). */
export function markedMetadata(n: number): number {
    return tokenMetadata({ foreground: n });
}

/** Пары `[начало, метаданные]` → `Uint32Array` в формате `tokenizeEncoded` (начала токенов). */
export function encodeTokens(tokens: readonly (readonly [startIndex: number, metadata: number])[]): Uint32Array {
    return new Uint32Array(tokens.flat());
}

/** Результат `tokenizeEncoded` из пар `[начало, метаданные]`. */
export function encodedResult(
    tokens: readonly (readonly [startIndex: number, metadata: number])[],
    endState: IState,
): EncodedTokenizationResult {
    return new EncodedTokenizationResult(encodeTokens(tokens), [], endState);
}

/**
 * Токены строки длиной `lineLength` в формате хранения (`setLineTokens`,
 * `LineTokens`): пары `[начало, метаданные]` переводятся в концы токенов,
 * последний кончается концом строки.
 */
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
