/** Цвета уже резолвнуты хостом (packed-RGB) через {@link IThemeColorResolver}. */
export interface IFileDecorationsService {
    /** По абсолютному пути; полный набор — пустой массив снимает все. */
    setFileDecorations(entries: readonly { path: string; color?: number; badge?: string; propagate?: boolean }[]): void;
}

export const NULL_FILE_DECORATIONS_SERVICE: IFileDecorationsService = {
    setFileDecorations: () => undefined,
};
