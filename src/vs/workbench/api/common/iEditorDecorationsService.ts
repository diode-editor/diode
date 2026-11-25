import type { IExtensionTextDecorationSet } from "../../../editor/common/model/iExtensionTextDecoration.ts";
import type { IGlyphMarginDecoration } from "../../../editor/common/model/iGlyphMarginDecoration.ts";
import type { IOverviewRulerDecoration } from "../../../editor/common/model/iOverviewRulerDecoration.ts";

/**
 * Colors arrive already resolved (packed RGBA): the host resolves the theme via {@link IThemeColorResolver}.
 * Each method takes the full set for the resource across all its editors; an empty array clears.
 * `uri` is `uri.toString()`, not a path.
 */
export interface IEditorDecorationsService {
    setOverviewRulerDecorations(uri: string, decorations: readonly IOverviewRulerDecoration[]): void;
    setExtensionTextDecorations(uri: string, set: IExtensionTextDecorationSet): void;
    /** The owner's glyphs in the glyph lane (`gutterIconPath` of one decoration type). */
    setGlyphMarginDecorations(uri: string, owner: string, decorations: readonly IGlyphMarginDecoration[]): void;
}

export const NULL_EDITOR_DECORATIONS_SERVICE: IEditorDecorationsService = {
    setOverviewRulerDecorations: () => undefined,
    setExtensionTextDecorations: () => undefined,
    setGlyphMarginDecorations: () => undefined,
};
