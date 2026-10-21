import type { IThemeFile } from "../../../../../platform/theme/common/iThemeFile.ts";

import { dark2026Theme } from "./dark2026.ts";
import { darkModernTheme } from "./darkModern.ts";
import { darkPlusTheme } from "./darkPlus.ts";
import { lightModernTheme } from "./lightModern.ts";
import { lightPlusTheme } from "./lightPlus.ts";
import { monokaiTheme } from "./monokai.ts";

/** Order here is the order shown in the theme picker. */
export const builtinThemes: readonly IThemeFile[] = [
    dark2026Theme,
    darkModernTheme,
    darkPlusTheme,
    monokaiTheme,
    lightModernTheme,
    lightPlusTheme,
];

/** Mirrored by the configuration default in `workbench/common/configuration/workbenchConfiguration.ts`. */
export const DEFAULT_COLOR_THEME = "Dark Modern";
