import type { IDisposable } from "../../../base/common/lifecycle.ts";

import { ColorThemeKind } from "./vscodeTypes.ts";

/** Через него же едет вид темы для `window.activeColorTheme`: событие смены у обоих потребителей одно. */
export interface IThemeColorResolver {
    /** packed-RGB; `undefined` — такого цвета нет. */
    resolve(id: string): number | undefined;
    kind(): ColorThemeKind;
    /** Без немедленного вызова. */
    onDidChange(cb: () => void): IDisposable;
}

export const NULL_THEME_COLOR_RESOLVER: IThemeColorResolver = {
    resolve: () => undefined,
    // Дефолт — тёмная, как у VS Code без настройки темы.
    kind: () => ColorThemeKind.Dark,
    onDidChange: () => ({ dispose: () => undefined }),
};
