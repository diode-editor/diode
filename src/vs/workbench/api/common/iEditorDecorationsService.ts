import type { IGutterChangeDecoration } from "../../../editor/common/model/iGutterChangeDecoration.ts";

/** Цвета приходят уже резолвнутыми (packed-RGB): тему резолвит хост через {@link IThemeColorResolver}. */
export interface IEditorDecorationsService {
    /** Полный набор для ресурса по всем его редакторам; пустой массив снимает. `uri` — `uri.toString()`, не путь. */
    setGutterChangeDecorations(uri: string, decorations: readonly IGutterChangeDecoration[]): void;
}

export const NULL_EDITOR_DECORATIONS_SERVICE: IEditorDecorationsService = {
    setGutterChangeDecorations: () => undefined,
};
