import { StyleFlags } from "@tuidom/core/common/styleFlags";

import type { ISemanticTokensLegend } from "../common/languages/iSemanticTokensSource.ts";
import type {
    ISemanticTokenStyleResolver,
    SemanticTokenStyle,
} from "../common/languages/iSemanticTokenStyleResolver.ts";
import type { ResolvedTokenStyle } from "../common/languages/iTokenStyleResolver.ts";
import type { LineTokens } from "../common/tokens/lineTokens.ts";
import type { ISemanticLineTokens } from "../common/tokens/semanticTokensLines.ts";

export function packStyleFlags(style: ResolvedTokenStyle): number {
    let flags = 0;
    if (style.bold) flags |= StyleFlags.Bold;
    if (style.italic) flags |= StyleFlags.Italic;
    if (style.underline) flags |= StyleFlags.Underline;
    if (style.strikethrough) flags |= StyleFlags.Strikethrough;
    return flags;
}

/** Курсор под проход слева направо; запрос левее прошлого перематывает в начало. */
export class TokenIndex {
    private readonly tokens: LineTokens;
    private readonly count: number;
    private readonly lineLength: number;
    private cursor = 0;

    public constructor(lineTokens: LineTokens, lineLength: number) {
        this.tokens = lineTokens;
        this.count = lineTokens.getCount();
        this.lineLength = lineLength;
    }

    public metadataAt(offset: number): number | undefined {
        if (offset >= this.lineLength) return undefined;

        let i = this.cursor;
        // Stryker disable next-line ConditionalExpression,EqualityOperator: «с нуля» чаще даёт тот же токен, только медленнее
        if (this.tokens.getStartOffset(i) > offset) {
            i = 0;
        }
        // Граница — страховка: конец последнего токена — длина строки, а offset меньше неё.
        // Stryker disable next-line ArithmeticOperator,EqualityOperator,ConditionalExpression: см. выше
        while (i + 1 < this.count && this.tokens.getEndOffset(i) <= offset) {
            i++;
        }
        this.cursor = i;
        return this.tokens.getMetadata(i);
    }
}

export type SemanticStyleLookup = (
    legend: ISemanticTokensLegend,
    tokenType: number,
    tokenModifiers: number,
) => SemanticTokenStyle | null;

/**
 * `getMetadata` эталона (`semanticTokensProviderStyling.ts`): типа нет в легенде —
 * стиля нет, биты модификаторов за пределами легенды игнорируются.
 */
export function resolveSemanticTokenStyle(
    resolver: ISemanticTokenStyleResolver,
    languageId: string,
    legend: ISemanticTokensLegend,
    tokenType: number,
    tokenModifiers: number,
): SemanticTokenStyle | null {
    const type = legend.tokenTypes.at(tokenType);
    if (type === undefined || type === "") return null;
    const modifiers: string[] = [];
    let modifierSet = tokenModifiers;
    for (const modifier of legend.tokenModifiers) {
        if (modifierSet & 1) modifiers.push(modifier);
        modifierSet = modifierSet >>> 1;
    }
    return resolver.resolve(type, modifiers, languageId);
}

/** Токены разрежены: между ними TextMate не перекрывается. */
export class SemanticTokenIndex {
    private readonly tokens: readonly number[];
    private cursor = 0;

    public constructor(
        private readonly line: ISemanticLineTokens,
        private readonly lookup: SemanticStyleLookup,
    ) {
        this.tokens = line.tokens;
    }

    public styleAt(offset: number): SemanticTokenStyle | null {
        const tokens = this.tokens;
        let i = this.cursor;
        // Перемотка в 0 и без нужды даёт тот же ответ, только медленнее; граница
        // `tokens[i] > offset` — тоже про скорость.
        // Stryker disable next-line ConditionalExpression,EqualityOperator: см. выше
        if (i >= tokens.length || tokens[i] > offset) i = 0;
        // За последним токеном `tokens[i + 1]` — undefined, сравнение ложно.
        while (tokens[i + 1] <= offset) i += 4;
        this.cursor = i;
        if (i >= tokens.length || tokens[i] > offset) return null;
        return this.lookup(this.line.legend, tokens[i + 2], tokens[i + 3]);
    }
}

/** Заменяются только атрибуты, заданные семантическим стилем (маски `SEMANTIC_USE_*` эталона). */
export function applySemanticStyle(
    semantic: SemanticTokenStyle,
    fg: number,
    flags: number,
): { fg: number; flags: number } {
    let result = flags;
    const setFlag = (value: boolean | undefined, flag: number): void => {
        if (value === undefined) return;
        result = value ? result | flag : result & ~flag;
    };
    setFlag(semantic.bold, StyleFlags.Bold);
    setFlag(semantic.italic, StyleFlags.Italic);
    setFlag(semantic.underline, StyleFlags.Underline);
    setFlag(semantic.strikethrough, StyleFlags.Strikethrough);
    return { fg: semantic.fg ?? fg, flags: result };
}
