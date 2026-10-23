import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

export const windowConfiguration = {
    id: "window",
    title: "Window",
    properties: {
        // The "system color mode" is the host terminal's scheme: mode 2031 reports, else the OSC 11 background
        // (HostColorSchemeService). `window.autoDetectHighContrast` is not supported: a terminal reports no contrast.
        "window.autoDetectColorScheme": {
            scope: "window",
            type: "boolean",
            default: false,
            description:
                "If enabled, will automatically select a color theme based on the system color mode. If the system " +
                "color mode is dark, `#workbench.preferredDarkColorTheme#` is used, else " +
                "`#workbench.preferredLightColorTheme#`.",
        },
    },
} as const satisfies IConfigurationNode;
