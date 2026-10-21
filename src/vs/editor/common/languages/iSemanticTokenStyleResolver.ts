import { Event } from "../../../base/common/event.ts";
import { token } from "../../../platform/instantiation/common/diContainer.ts";

/**
 * A field set to `undefined` means the theme does not define that attribute, so it is
 * kept from the TextMate token underneath (upstream `SEMANTIC_USE_*` masks).
 */
export interface SemanticTokenStyle {
    readonly fg?: number;
    readonly bold?: boolean;
    readonly italic?: boolean;
    readonly underline?: boolean;
    readonly strikethrough?: boolean;
}

/** Upstream `IColorTheme.getTokenStyleMetadata`. */
export interface ISemanticTokenStyleResolver {
    /** `null`: no attribute is set, so the token does not override TextMate. */
    resolve(type: string, modifiers: readonly string[], languageId: string): SemanticTokenStyle | null;

    /** The `configuredByTheme` value of the setting. */
    readonly semanticHighlighting: boolean;

    readonly onDidChange: Event<void>;
}

export const NULL_SEMANTIC_TOKEN_STYLE_RESOLVER: ISemanticTokenStyleResolver = {
    resolve: () => null,
    semanticHighlighting: false,
    onDidChange: Event.None,
};

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by its reference; the string is only a debug label
export const SemanticTokenStyleResolverDIToken = token<ISemanticTokenStyleResolver>("SemanticTokenStyleResolver");
