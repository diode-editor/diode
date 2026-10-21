import { Event } from "../../../base/common/event.ts";
import { token } from "../../../platform/instantiation/common/diContainer.ts";

/**
 * Стиль семантического токена. `undefined` в поле — тема атрибут не задаёт, и
 * он остаётся от TextMate-токена под ним (маски `SEMANTIC_USE_*` эталона).
 */
export interface SemanticTokenStyle {
    readonly fg?: number;
    readonly bold?: boolean;
    readonly italic?: boolean;
    readonly underline?: boolean;
    readonly strikethrough?: boolean;
}

/** `IColorTheme.getTokenStyleMetadata` эталона. */
export interface ISemanticTokenStyleResolver {
    /** `null` — ни один атрибут не задан: токен не перекрывает TextMate. */
    resolve(type: string, modifiers: readonly string[], languageId: string): SemanticTokenStyle | null;

    /** Значение `configuredByTheme` настройки. */
    readonly semanticHighlighting: boolean;

    readonly onDidChange: Event<void>;
}

export const NULL_SEMANTIC_TOKEN_STYLE_RESOLVER: ISemanticTokenStyleResolver = {
    resolve: () => null,
    semanticHighlighting: false,
    onDidChange: Event.None,
};

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const SemanticTokenStyleResolverDIToken = token<ISemanticTokenStyleResolver>("SemanticTokenStyleResolver");
