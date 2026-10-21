import type { IGutterChangeDecoration } from "../../../editor/common/model/iGutterChangeDecoration.ts";

/** Colors arrive already resolved (packed RGB): the host resolves the theme via {@link IThemeColorResolver}. */
export interface IEditorDecorationsService {
    /** Full set for the resource across all its editors; an empty array clears. `uri` is `uri.toString()`, not a path. */
    setGutterChangeDecorations(uri: string, decorations: readonly IGutterChangeDecoration[]): void;
}

export const NULL_EDITOR_DECORATIONS_SERVICE: IEditorDecorationsService = {
    setGutterChangeDecorations: () => undefined,
};
