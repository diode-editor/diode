/** Colors are already resolved by the host (packed RGB) via {@link IThemeColorResolver}. */
export interface IFileDecorationsService {
    /** By absolute path; full set: an empty array clears all. */
    setFileDecorations(entries: readonly { path: string; color?: number; badge?: string; propagate?: boolean }[]): void;
}

export const NULL_FILE_DECORATIONS_SERVICE: IFileDecorationsService = {
    setFileDecorations: () => undefined,
};
