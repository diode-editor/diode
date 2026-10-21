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

/** Cursor tuned for a left-to-right scan; a query left of the previous one rewinds to the start. */
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
        // Stryker disable next-line ConditionalExpression,EqualityOperator: restarting from zero usually yields the same token, just slower
        if (this.tokens.getStartOffset(i) > offset) {
            i = 0;
        }
        // The bound is a safety net: the last token ends at the line length, and offset is below it.
        // Stryker disable next-line ArithmeticOperator,EqualityOperator,ConditionalExpression: see above
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
 * Port of upstream `getMetadata` (`semanticTokensProviderStyling.ts`): a type missing from the
 * legend yields no style; modifier bits beyond the legend are ignored.
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

/** Tokens are sparse: TextMate styling is not overridden between them. */
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
        // An unneeded rewind to 0 gives the same answer, just slower; the `tokens[i] > offset`
        // bound is about speed too.
        // Stryker disable next-line ConditionalExpression,EqualityOperator: see above
        if (i >= tokens.length || tokens[i] > offset) i = 0;
        // Past the last token `tokens[i + 1]` is undefined, so the comparison is false.
        while (tokens[i + 1] <= offset) i += 4;
        this.cursor = i;
        if (i >= tokens.length || tokens[i] > offset) return null;
        return this.lookup(this.line.legend, tokens[i + 2], tokens[i + 3]);
    }
}

/** Only attributes set by the semantic style are replaced (upstream `SEMANTIC_USE_*` masks). */
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
