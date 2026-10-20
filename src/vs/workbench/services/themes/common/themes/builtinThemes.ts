import type { IThemeFile } from "../../../../../platform/theme/common/iThemeFile.ts";

import { dark2026Theme } from "./dark2026.ts";
import { darkModernTheme } from "./darkModern.ts";
import { darkPlusTheme } from "./darkPlus.ts";
import { lightModernTheme } from "./lightModern.ts";
import { lightPlusTheme } from "./lightPlus.ts";
import { monokaiTheme } from "./monokai.ts";

/**
 * Built-in color themes, imported verbatim from VS Code's default theme
 * extensions (`theme-defaults`, `theme-monokai`) by
 * `scripts/import-vscode-themes.mjs`. Order here is the order shown in the
 * theme picker.
 *
 * Themes contributed by installed extensions (`contributes.themes`) are
 * registered by `ExtensionThemeContributor` — see docs/arch/Theme.md.
 */
export const builtinThemes: readonly IThemeFile[] = [
    dark2026Theme,
    darkModernTheme,
    darkPlusTheme,
    monokaiTheme,
    lightModernTheme,
    lightPlusTheme,
];

/**
 * Default active theme, matching VS Code's out-of-the-box default. Used when the
 * `workbench.colorTheme` setting is unset or names an unknown theme. Mirrored by
 * the configuration default in `src/Workbench/Configuration/workbenchConfiguration.ts`.
 */
export const DEFAULT_COLOR_THEME = "Dark Modern";
