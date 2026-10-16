/**
 * Тонкий «port» поверх Explorer'а (`ExplorerService` в Workbench), нужный
 * {@link ExtensionHost} для проекции файловых декораций расширения (цвет имени +
 * бейдж) на дерево без прямого знания о слое Workbench внутри host-моста.
 *
 * Цвета приходят уже резолвнутыми (packed-RGB) — тема резолвится на стороне
 * host'а через {@link IThemeColorResolver}. Паттерн повторяет
 * {@link IEditorOptionsService}: адаптер живёт в слое Extensions.
 */
export interface IFileDecorationsService {
    /**
     * Проставляет полный набор файловых декораций (по абсолютному пути). Пустой
     * массив снимает все.
     */
    setFileDecorations(entries: readonly { path: string; color?: number; badge?: string; propagate?: boolean }[]): void;
}

/** No-op реализация — для тестов/профилей без моста декораций. */
export const NULL_FILE_DECORATIONS_SERVICE: IFileDecorationsService = {
    setFileDecorations: () => undefined,
};
