import type { IDisposable } from "@tuidom/all/common/disposable";

/**
 * Тонкий «port» поверх {@link ThemeService}, нужный {@link ExtensionHost} для
 * резолва `vscode.ThemeColor` id → packed-RGB и пере-резолва при смене темы, без
 * прямого знания о слое Theme внутри host-моста.
 */
export interface IThemeColorResolver {
    /** Резолвит id цвета темы (напр. `"gitDecoration.modifiedResourceForeground"`) в packed-RGB; `undefined`, если такого цвета нет. */
    resolve(id: string): number | undefined;
    /** Подписка на смену темы (без немедленного вызова). Возвращает Disposable. */
    onDidChange(cb: () => void): IDisposable;
}

/** No-op реализация — для тестов/профилей без моста декораций. */
export const NULL_THEME_COLOR_RESOLVER: IThemeColorResolver = {
    resolve: () => undefined,
    onDidChange: () => ({ dispose: () => undefined }),
};
