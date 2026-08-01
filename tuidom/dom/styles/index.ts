export type { AnyStyleToken, StyleToken } from "./styleTokens.ts";
export { ROOT_VAR_SCOPE, STYLE_TOKEN_DEFAULTS } from "./styleTokens.ts";
export type {
    ResolvedTUIStyle,
    StyleColor,
    StyleResolutionContext,
    StyleState,
    StyleStateSelector,
    StyleStateVariant,
    StyleVarScope,
    TUIStyle,
} from "./tuiStyle.ts";
export {
    extendVarScope,
    INHERITED_BG,
    INHERITED_FG,
    mergeStyleVariants,
    resolveStyle,
    resolveStyleColor,
    ROOT_RESOLVED_STYLE,
    ROOT_STYLE_CONTEXT,
    styleEquals,
} from "./tuiStyle.ts";
