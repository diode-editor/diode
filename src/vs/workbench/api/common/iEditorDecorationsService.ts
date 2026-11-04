import type { IExtensionTextDecoration } from "../../../editor/common/model/iExtensionTextDecoration.ts";
import type { IGutterChangeDecoration } from "../../../editor/common/model/iGutterChangeDecoration.ts";

/**
 * Colors arrive already resolved (packed RGB/RGBA): the host resolves the theme via {@link IThemeColorResolver}.
 * Each method takes the full set for the resource across all its editors; an empty array clears.
 * `uri` is `uri.toString()`, not a path.
 */
export interface IEditorDecorationsService {
    setGutterChangeDecorations(uri: string, decorations: readonly IGutterChangeDecoration[]): void;
    setExtensionTextDecorations(uri: string, decorations: readonly IExtensionTextDecoration[]): void;
}

export const NULL_EDITOR_DECORATIONS_SERVICE: IEditorDecorationsService = {
    setGutterChangeDecorations: () => undefined,
    setExtensionTextDecorations: () => undefined,
};
