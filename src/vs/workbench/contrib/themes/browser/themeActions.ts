import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { ThemeRegistryDIToken, ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";

/** Human-readable base-type label shown next to a theme in the picker. */
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

/**
 * Color-theme picker (VS Code `workbench.action.selectTheme`). Lists every
 * registered theme, applies it live as you arrow through the list, and on
 * Enter persists the choice to `workbench.colorTheme`. Escape / dismiss
 * restores the theme that was active before the picker opened.
 */
async function selectColorTheme(accessor: ServiceAccessor): Promise<void> {
    const themeService = accessor.get(ThemeServiceDIToken);
    const themeRegistry = accessor.get(ThemeRegistryDIToken);
    const configurationService = accessor.get(IConfigurationServiceDIToken);
    const quickInput = accessor.get(QuickInputServiceDIToken);

    const originalTheme = themeService.theme;
    const descriptors = themeRegistry.list();

    const items = descriptors.map((d) => ({
        label: d.label,
        description: themeTypeLabel(d.type),
    }));
    const activeIndex = Math.max(
        0,
        descriptors.findIndex((d) => d.label === originalTheme.name),
    );

    const applyByLabel = (label: string): void => {
        const theme = themeRegistry.resolve(label);
        /* v8 ignore start -- defensive: `label` always originates from the registry's own list()/picker items, so resolve() never returns undefined */
        if (theme) themeService.setTheme(theme);
        /* v8 ignore stop */
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
        // Cancelled — undo any live preview by restoring the original theme.
        themeService.setTheme(originalTheme);
        return;
    }

    applyByLabel(picked.label);
    void configurationService.updateUserValue?.("workbench.colorTheme", picked.label);
}

/**
 * Open the color-theme picker. Default chord matches VS Code (Ctrl+K Ctrl+T).
 */
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
