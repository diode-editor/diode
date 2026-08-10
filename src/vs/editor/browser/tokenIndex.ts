import { StyleFlags } from "../../../../tuidom/common/styleFlags.ts";

import type { ILineTokens, IToken } from "../common/languages/iLineTokens.ts";
import type { ResolvedTokenStyle } from "../common/languages/iTokenStyleResolver.ts";

/**
 * Подсветка синтаксиса на уровне ячеек: общая часть редактора и дифф-вью.
 * Жила в `editorElement.ts` и экспортировалась оттуда ради диффа; вынесена в
 * свой файл, чтобы дифф не зависел от редактора целиком.
 */

/** Флаги начертания из разрешённого стиля токена — в битовую маску ячейки. */
export function packStyleFlags(style: ResolvedTokenStyle): number {
    let flags = 0;
    if (style.bold) flags |= StyleFlags.Bold;
    if (style.italic) flags |= StyleFlags.Italic;
    if (style.underline) flags |= StyleFlags.Underline;
    if (style.strikethrough) flags |= StyleFlags.Strikethrough;
    return flags;
}

/**
 * Linear cursor over a sorted token array, optimised for left-to-right
 * scans (which is how the renderer walks columns). Falls back to binary
 * search when the offset rewinds.
 *
 * Exported for unit testing: the renderer only ever scans forward, so the
 * rewind path is unreachable through rendering alone.
 */
export class TokenIndex {
    private readonly tokens: readonly IToken[];
    private readonly lineLength: number;
    private cursor = 0;

    public constructor(lineTokens: ILineTokens, lineLength: number) {
        this.tokens = lineTokens.tokens;
        this.lineLength = lineLength;
    }

    /** Token covering `[token.startIndex .. nextToken.startIndex)` for `offset`. */
    public tokenAt(offset: number): IToken | undefined {
        if (this.tokens.length === 0 || offset >= this.lineLength) return undefined;

        // Fast path: forward scan.
        let i = this.cursor;
        if (i >= this.tokens.length || this.tokens[i].startIndex > offset) {
            i = 0; // rewind
        }
        while (i + 1 < this.tokens.length && this.tokens[i + 1].startIndex <= offset) {
            i++;
        }
        this.cursor = i;
        return this.tokens[i];
    }
}
