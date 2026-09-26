import type { IDisposable } from "@tuidom/core/common/disposable";

import { ColorThemeKind } from "./vscodeTypes.ts";

/**
 * Тонкий «port» поверх {@link ThemeService}, нужный {@link ExtensionHost} для
 * резолва `vscode.ThemeColor` id → packed-RGB и пере-резолва при смене темы, без
 * прямого знания о слое Theme внутри host-моста. Через него же едет вид активной
 * темы для `window.activeColorTheme` — второго порта к теме заводить не за чем,
 * событие смены у обоих потребителей одно и то же.
 */
export interface IThemeColorResolver {
    /** Резолвит id цвета темы (напр. `"gitDecoration.modifiedResourceForeground"`) в packed-RGB; `undefined`, если такого цвета нет. */
    resolve(id: string): number | undefined;
    /** Вид активной темы (`vscode.ColorThemeKind`) — для `window.activeColorTheme`. */
    kind(): ColorThemeKind;
    /** Подписка на смену темы (без немедленного вызова). Возвращает Disposable. */
    onDidChange(cb: () => void): IDisposable;
}

/** No-op реализация — для тестов/профилей без моста декораций. */
export const NULL_THEME_COLOR_RESOLVER: IThemeColorResolver = {
    resolve: () => undefined,
    // Дефолт — тёмная, как у VS Code без настройки темы.
    kind: () => ColorThemeKind.Dark,
    onDidChange: () => ({ dispose: () => undefined }),
};
