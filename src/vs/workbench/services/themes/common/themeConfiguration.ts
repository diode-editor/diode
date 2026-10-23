import { unpackB, unpackG, unpackR } from "@tuidom/core/common/colorUtils";

import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { IStateDescriptor } from "../../../../platform/state/common/iStateService.ts";

/** The host's light/dark scheme; upstream's `ColorScheme` without the high-contrast pair (no terminal reports it). */
export type ColorScheme = "dark" | "light";

export type ColorThemeSettingId =
    | "workbench.colorTheme"
    | "workbench.preferredDarkColorTheme"
    | "workbench.preferredLightColorTheme";

/** Every key that can name the active theme: a change to any of them may switch it. */
export const COLOR_THEME_SETTING_IDS: readonly ColorThemeSettingId[] = [
    "workbench.colorTheme",
    "workbench.preferredDarkColorTheme",
    "workbench.preferredLightColorTheme",
];

export const AUTO_DETECT_COLOR_SCHEME_SETTING = "window.autoDetectColorScheme";

/**
 * Upstream `ThemeConfiguration.getColorThemeSettingId`: with detection on, the preferred key of the host's
 * scheme. Unlike upstream the scheme may be unknown (a terminal that answered nothing, a first start before
 * the reply) — then `workbench.colorTheme`, as with detection off.
 */
export function getColorThemeSettingId(
    configuration: IConfigurationService,
    hostScheme: ColorScheme | undefined,
): ColorThemeSettingId {
    if (hostScheme === undefined || !configuration.get(AUTO_DETECT_COLOR_SCHEME_SETTING)) return "workbench.colorTheme";
    return hostScheme === "dark" ? "workbench.preferredDarkColorTheme" : "workbench.preferredLightColorTheme";
}

/**
 * The last scheme the host reported. The first frame is drawn before the terminal answers: without the
 * remembered scheme a light terminal would start dark and flip a moment later.
 */
export const LAST_HOST_COLOR_SCHEME: IStateDescriptor<ColorScheme | null> = {
    key: "workbench.hostColorScheme",
    scope: "application",
    default: null,
};

/** A dark background makes a dark scheme: relative luminance (sRGB weights) below the midpoint. */
export function colorSchemeOfBackground(background: number): ColorScheme {
    const luminance = 0.2126 * unpackR(background) + 0.7152 * unpackG(background) + 0.0722 * unpackB(background);
    return luminance < 128 ? "dark" : "light";
}
