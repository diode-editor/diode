import { token } from "../../../platform/instantiation/common/diContainer.ts";

/**
 * Resolved style for a token, decoupled from any theme implementation.
 * Editor depends on this interface; concrete resolvers live in the Theme
 * layer (or in a future LSP semantic-tokens provider).
 */
export interface ResolvedTokenStyle {
    readonly fg?: number;
    readonly bg?: number;
    readonly bold: boolean;
    readonly italic: boolean;
    readonly underline: boolean;
    readonly strikethrough: boolean;
}

export const EMPTY_RESOLVED_TOKEN_STYLE: ResolvedTokenStyle = {
    fg: undefined,
    bg: undefined,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
};

/**
 * Maps a TextMate scope stack to a resolved style.
 *
 * `scopes` is the stack from most general (root) to most specific (top).
 */
export interface ITokenStyleResolver {
    resolve(scopes: readonly string[]): ResolvedTokenStyle;
}

/** Resolver that returns the empty style for everything (no highlighting). */
export const NULL_TOKEN_STYLE_RESOLVER: ITokenStyleResolver = {
    resolve(): ResolvedTokenStyle {
        return EMPTY_RESOLVED_TOKEN_STYLE;
    },
};

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const TokenStyleResolverDIToken = token<ITokenStyleResolver>("TokenStyleResolver");
