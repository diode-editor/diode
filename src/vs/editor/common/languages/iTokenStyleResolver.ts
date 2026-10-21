import { token } from "../../../platform/instantiation/common/diContainer.ts";

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

/** Цвета по умолчанию (`ColorId.Default*`) — `undefined`: ячейка берёт цвета редактора. */
export interface ITokenStyleResolver {
    resolve(metadata: number): ResolvedTokenStyle;
}

export const NULL_TOKEN_STYLE_RESOLVER: ITokenStyleResolver = {
    resolve(): ResolvedTokenStyle {
        return EMPTY_RESOLVED_TOKEN_STYLE;
    },
};

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const TokenStyleResolverDIToken = token<ITokenStyleResolver>("TokenStyleResolver");
