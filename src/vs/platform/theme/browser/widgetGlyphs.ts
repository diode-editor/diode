import type { GlyphTable, GlyphToken } from "@tuidom/core/dom/glyphTokens";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { IProductIconService } from "../common/productIconService.ts";

/**
 * Glyphs tuidom widgets draw themselves → codicon names, resolved through the icon service. Upstream
 * these are codicons too: tree twisties, the locked-group lock and `CompletionItemKinds.toIcon`.
 */
const WIDGET_CODICONS: Readonly<Record<GlyphToken, string>> = {
    "tree.expanded": "chevron-down",
    "tree.collapsed": "chevron-right",
    "editorTab.readOnly": "lock",
    "completionKind.text": "symbol-text",
    "completionKind.method": "symbol-method",
    "completionKind.function": "symbol-function",
    "completionKind.constructor": "symbol-constructor",
    "completionKind.field": "symbol-field",
    "completionKind.variable": "symbol-variable",
    "completionKind.class": "symbol-class",
    "completionKind.interface": "symbol-interface",
    "completionKind.module": "symbol-module",
    "completionKind.property": "symbol-property",
    "completionKind.unit": "symbol-unit",
    "completionKind.value": "symbol-value",
    "completionKind.enum": "symbol-enum",
    "completionKind.keyword": "symbol-keyword",
    "completionKind.snippet": "symbol-snippet",
    "completionKind.color": "symbol-color",
    "completionKind.file": "symbol-file",
    "completionKind.reference": "symbol-reference",
    "completionKind.folder": "symbol-folder",
    "completionKind.enumMember": "symbol-enum-member",
    "completionKind.constant": "symbol-constant",
    "completionKind.struct": "symbol-struct",
    "completionKind.event": "symbol-event",
    "completionKind.operator": "symbol-operator",
    "completionKind.typeParameter": "symbol-type-parameter",
};

/** `null` in Nerd Font mode: the tuidom defaults are the glyphs diode has always drawn. */
export function computeWidgetGlyphs(icons: IProductIconService): GlyphTable | null {
    if (icons.nerdFont) return null;
    const glyphs: Partial<Record<GlyphToken, string>> = {};
    for (const [token, name] of Object.entries(WIDGET_CODICONS) as [GlyphToken, string][]) {
        glyphs[token] = icons.codicon(name);
    }
    return glyphs;
}

/** Puts the widget glyphs into the root once and again on every `diode.icons.nerdFont` change. */
export function bindWidgetGlyphs(root: TUIElement, icons: IProductIconService): IDisposable {
    root.setGlyphs(computeWidgetGlyphs(icons));
    return icons.onDidChange(() => {
        root.setGlyphs(computeWidgetGlyphs(icons));
    });
}
