import type { IDisposable } from "../../../base/common/lifecycle.ts";

import { ColorThemeKind } from "./vscodeTypes.ts";

/** Also carries the theme kind for `window.activeColorTheme`: both consumers share one change event. */
export interface IThemeColorResolver {
    /** Packed RGB; `undefined` if there is no such color. */
    resolve(id: string): number | undefined;
    kind(): ColorThemeKind;
    /** Does not fire immediately. */
    onDidChange(cb: () => void): IDisposable;
}

export const NULL_THEME_COLOR_RESOLVER: IThemeColorResolver = {
    resolve: () => undefined,
    // Defaults to dark, like VS Code with no theme configured.
    kind: () => ColorThemeKind.Dark,
    onDidChange: () => ({ dispose: () => undefined }),
};
