import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { HostColorSchemeServiceDIToken } from "../../../services/themes/browser/hostColorSchemeService.ts";
import { getColorThemeSettingId } from "../../../services/themes/common/themeConfiguration.ts";
import { ThemeRegistryDIToken, ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";
import { openExtensionsSearch } from "../../extensions/browser/extensionsSearch.ts";

/**
 * Upstream `marketplaceTag` of the color theme picker. Our marketplace can't preview a theme it hasn't installed
 * (upstream `supportsExtensionGalleryResources` is false), so both entry points open the Extensions view with it.
 */
const COLOR_THEMES_QUERY = "category:themes";

/** Upstream `installMessage`: the picker's last item when the gallery can't serve themes inline. */
const INSTALL_COLOR_THEMES_LABEL = "Install Additional Color Themes...";

export function themeTypeLabel(type: "dark" | "light" | "hc" | "hcLight"): string {
    switch (type) {
        case "light":
            return "light";
        case "hc":
            return "high contrast";
        case "hcLight":
            return "high contrast light";
        default:
            return "dark";
    }
}

async function selectColorTheme(accessor: ServiceAccessor): Promise<void> {
    const themeService = accessor.get(ThemeServiceDIToken);
    const themeRegistry = accessor.get(ThemeRegistryDIToken);
    const configurationService = accessor.get(IConfigurationServiceDIToken);
    const quickInput = accessor.get(QuickInputServiceDIToken);
    const hostColorScheme = accessor.get(HostColorSchemeServiceDIToken);

    const originalTheme = themeService.theme;
    const descriptors = themeRegistry.list();

    const items = [
        ...descriptors.map((d) => ({
            label: d.label,
            description: themeTypeLabel(d.type),
        })),
        { label: INSTALL_COLOR_THEMES_LABEL },
    ];
    const activeIndex = Math.max(
        0,
        descriptors.findIndex((d) => d.label === originalTheme.name),
    );

    const applyByLabel = (label: string): void => {
        // The install item is no theme: highlighting it previews nothing, the last preview stays, like upstream.
        const theme = themeRegistry.resolve(label);
        if (theme) themeService.setTheme(theme);
    };

    const picked = await quickInput.quickPick({
        title: "Color Theme",
        placeholder: "Select Color Theme (Up/Down Keys to Preview)",
        items,
        activeIndex,
        onDidChangeActive: (item) => {
            if (item) applyByLabel(item.label);
        },
    });

    if (picked === undefined) {
        themeService.setTheme(originalTheme);
        return;
    }
    if (picked.label === INSTALL_COLOR_THEMES_LABEL) {
        themeService.setTheme(originalTheme);
        openExtensionsSearch(accessor, COLOR_THEMES_QUERY);
        return;
    }

    applyByLabel(picked.label);
    // With detection on, the pick goes to the preferred theme of the current scheme, as upstream `setColorTheme`.
    const settingId = getColorThemeSettingId(configurationService, hostColorScheme.colorScheme);
    void configurationService.updateValue(settingId, picked.label);
}

export const selectThemeAction: CommandAction = {
    id: "workbench.action.selectTheme",
    title: "Preferences: Color Theme",
    shortTitle: "Color Theme",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "2_theme", order: 10 }],
    keybinding: parseChord("mod+k mod+t"),
    run(accessor) {
        void selectColorTheme(accessor);
    },
};

/** Upstream falls back to `openSearch('category:themes')` without gallery resources, which is always our case. */
export const browseColorThemesInMarketplaceAction: CommandAction = {
    id: "workbench.action.browseColorThemesInMarketplace",
    title: "Preferences: Browse Color Themes in Marketplace",
    run(accessor) {
        openExtensionsSearch(accessor, COLOR_THEMES_QUERY);
    },
};

export const THEME_ACTIONS: readonly CommandAction[] = [selectThemeAction, browseColorThemesInMarketplaceAction];
