import { packRgb } from "@tuidom/core/common/colorUtils";
import { describe, expect, it } from "vitest";

import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";

import { colorSchemeOfBackground, getColorThemeSettingId } from "./themeConfiguration.ts";

describe("getColorThemeSettingId", () => {
    it("detection on: the preferred key of the host scheme", () => {
        const configuration = createTestConfigurationService({ "window.autoDetectColorScheme": true });
        expect(getColorThemeSettingId(configuration, "dark")).toBe("workbench.preferredDarkColorTheme");
        expect(getColorThemeSettingId(configuration, "light")).toBe("workbench.preferredLightColorTheme");
    });

    it("detection on, scheme unknown: workbench.colorTheme", () => {
        const configuration = createTestConfigurationService({ "window.autoDetectColorScheme": true });
        expect(getColorThemeSettingId(configuration, undefined)).toBe("workbench.colorTheme");
    });

    it("detection off (the default): workbench.colorTheme whatever the scheme", () => {
        const configuration = createTestConfigurationService();
        expect(getColorThemeSettingId(configuration, "light")).toBe("workbench.colorTheme");
    });
});

describe("colorSchemeOfBackground", () => {
    it("splits by relative luminance at the midpoint, green weighing most", () => {
        expect(colorSchemeOfBackground(packRgb(0, 0, 0))).toBe("dark");
        expect(colorSchemeOfBackground(packRgb(0xff, 0xff, 0xff))).toBe("light");
        expect(colorSchemeOfBackground(packRgb(0x1e, 0x1e, 0x2e))).toBe("dark");
        // Pure green is bright, pure blue is dark — a plain channel average would call both "dark".
        expect(colorSchemeOfBackground(packRgb(0, 0xff, 0))).toBe("light");
        expect(colorSchemeOfBackground(packRgb(0, 0, 0xff))).toBe("dark");
        // The boundary: 128 gray is light, 127 is dark.
        expect(colorSchemeOfBackground(packRgb(128, 128, 128))).toBe("light");
        expect(colorSchemeOfBackground(packRgb(127, 127, 127))).toBe("dark");
    });
});
