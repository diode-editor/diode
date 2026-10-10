import { StyleFlags } from "@tuidom/core/common/styleFlags";

import type { ILineTokens, IToken } from "../common/languages/iLineTokens.ts";
import type { ISemanticTokensLegend } from "../common/languages/iSemanticTokensSource.ts";
import type {
    ISemanticTokenStyleResolver,
    SemanticTokenStyle,
} from "../common/languages/iSemanticTokenStyleResolver.ts";
import type { ResolvedTokenStyle } from "../common/languages/iTokenStyleResolver.ts";
import type { ISemanticLineTokens } from "../common/tokens/semanticTokensLines.ts";

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

/** Стиль семантического токена по индексам легенды; `null` — токен TextMate не перекрывает. */
export type SemanticStyleLookup = (
    legend: ISemanticTokensLegend,
    tokenType: number,
    tokenModifiers: number,
) => SemanticTokenStyle | null;

/**
 * Стиль семантического токена по легенде провайдера (`getMetadata` эталона,
 * `semanticTokensProviderStyling.ts`): индекс типа → имя (нет в легенде —
 * стиля нет), биты модификаторов → имена (биты за пределами легенды
 * игнорируются), дальше — тема.
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

/**
 * Курсор по семантическим токенам строки (второй слой поверх {@link TokenIndex}):
 * токены разрежены, между ними TextMate не перекрывается.
 */
export class SemanticTokenIndex {
    private readonly tokens: readonly number[];
    private cursor = 0;

    public constructor(
        private readonly line: ISemanticLineTokens,
        private readonly lookup: SemanticStyleLookup,
    ) {
        this.tokens = line.tokens;
    }

    /** Стиль токена, накрывающего `offset`; `null` — токена нет или он без стиля. */
    public styleAt(offset: number): SemanticTokenStyle | null {
        const tokens = this.tokens;
        let i = this.cursor;
        // Перемотка в 0 и без нужды даёт тот же ответ, только медленнее; сама
        // перемотка (запрос левее прошлого, в том числе из-за конца строки)
        // проверена тестом.
        // Граница `tokens[i] > offset` тоже лишь про скорость.
        // Stryker disable next-line ConditionalExpression,EqualityOperator: см. выше
        if (i >= tokens.length || tokens[i] > offset) i = 0; // rewind
        // За последним токеном `tokens[i + 1]` — undefined, сравнение ложно.
        while (tokens[i + 1] <= offset) i += 4;
        this.cursor = i;
        if (i >= tokens.length || tokens[i] > offset) return null;
        return this.lookup(this.line.legend, tokens[i + 2], tokens[i + 3]);
    }
}

/**
 * Накладывает семантический стиль на стиль ячейки: заменяются только атрибуты,
 * которые семантический стиль задаёт (маски `SEMANTIC_USE_*` эталона).
 */
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
