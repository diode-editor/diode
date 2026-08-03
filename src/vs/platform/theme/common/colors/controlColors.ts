import type { ColorContribution } from "../colorRegistry.ts";

/** Контролы: кнопки, скроллбары, списки/деревья, меню. */
export const controlColors = {
    "button.background": {
        defaults: { dark: "#0078D7", light: "#005FB8" },
        description: "Button background color.",
    },
    "button.foreground": {
        defaults: { dark: "#FFFFFF", light: "#FFFFFF" },
        description: "Button foreground color.",
    },
    "button.hoverBackground": {
        defaults: { dark: "#1A86E0", light: "#0258A8" },
        description: "Button background color when hovering.",
    },
    "button.secondaryForeground": {
        defaults: { dark: "#CCCCCC", light: "#3B3B3B" },
        description: "Secondary button foreground color.",
    },
    "button.secondaryBackground": {
        defaults: { dark: "#3C3C3C", light: "#E5E5E5" },
        description: "Secondary button background color.",
    },
    "button.secondaryHoverBackground": {
        defaults: { dark: "#45494E", light: "#CCCCCC" },
        description: "Secondary button background color when hovering.",
    },
    // VS Code leaves `scrollbar.background` unset (a transparent track); we draw
    // the track as a visible dim line, so it needs a real default here.
    "scrollbar.background": {
        defaults: { dark: "#3A3D3E", light: "#DADADA" },
        description: "Scrollbar track background color.",
    },
    "scrollbarSlider.background": {
        defaults: { dark: "#79797966", light: "#64646466" },
        description: "Scrollbar slider background color.",
    },
    "list.activeSelectionBackground": {
        defaults: { dark: "#04395E", light: "#E8E8E8" },
        description: "List/Tree background color for the selected item when the list/tree is active.",
    },
    "list.activeSelectionForeground": {
        defaults: { dark: "#FFFFFF", light: "#000000" },
        description: "List/Tree foreground color for the selected item when the list/tree is active.",
    },
    "list.hoverBackground": {
        defaults: { dark: "#2A2D2E", light: "#F2F2F2" },
        description: "List/Tree background when hovering over items using the mouse.",
    },
    "list.hoverForeground": {
        defaults: null,
        description: "List/Tree foreground when hovering over items using the mouse.",
    },
    "list.inactiveSelectionBackground": {
        defaults: { dark: "#37373D", light: "#E4E6F1" },
        description: "List/Tree background color for the selected item when the list/tree is inactive.",
    },
    "list.inactiveSelectionForeground": {
        defaults: { dark: "#CCCCCC", light: "#3B3B3B" },
        description: "List/Tree foreground color for the selected item when the list/tree is inactive.",
    },
    "list.deemphasizedForeground": {
        defaults: { dark: "#808080", light: "#8E8E90" },
        description: "List/Tree foreground color for items that are deemphasized (e.g. cut in explorer).",
    },
    // Значения — из реестра VS Code (`colorRegistry.ts`); `dropdown.listBackground`
    // там `null` (наследует editorWidget.background), поэтому берём то, что и так
    // везут наши импортированные темы.
    "dropdown.background": {
        defaults: { dark: "#3C3C3C", light: "#FFFFFF" },
        description: "Dropdown background.",
    },
    "dropdown.foreground": {
        defaults: { dark: "#F0F0F0", light: "#3B3B3B" },
        description: "Dropdown foreground.",
    },
    "dropdown.border": {
        defaults: { dark: "#3C3C3C", light: "#CECECE" },
        description: "Dropdown border.",
    },
    "dropdown.listBackground": {
        defaults: { dark: "#1F1F1F", light: "#FFFFFF" },
        description: "Dropdown list background.",
    },
    "menu.foreground": {
        defaults: { dark: "#CCCCCC", light: "#616161" },
        description: "Foreground color of menu items.",
    },
    "menu.background": {
        defaults: { dark: "#252526", light: "#FFFFFF" },
        description: "Background color of menu items.",
    },
    "menu.selectionForeground": {
        defaults: { dark: "#FFFFFF", light: "#FFFFFF" },
        description: "Foreground color of the selected menu item in menus.",
    },
    "menu.selectionBackground": {
        defaults: { dark: "#04395E", light: "#005FB8" },
        description: "Background color of the selected menu item in menus.",
    },
    "menu.separatorBackground": {
        defaults: { dark: "#535353", light: "#D4D4D4" },
        description: "Color of a separator menu item in menus.",
    },
    "menu.border": {
        defaults: { dark: "#535353", light: "#CECECE" },
        description: "Border color of menus.",
    },
    // Значения — из реестра VS Code (`colorRegistry.ts`), кроме отмеченных:
    // там наши исторические дефолты сохраняют вид встроенных тем 1:1 (Н3).
    "input.foreground": {
        defaults: { dark: "#CCCCCC", light: "#3B3B3B" },
        description: "Input box foreground.",
    },
    "input.background": {
        defaults: { dark: "#3C3C3C", light: "#FFFFFF" },
        description: "Input box background.",
    },
    "input.border": {
        defaults: { dark: "#3C3C3C", light: "#CECECE" },
        description: "Input box border.",
    },
    "input.placeholderForeground": {
        // Исторический цвет плейсхолдера Vexx (у VS Code — #989898 поверх прозрачности).
        defaults: { dark: "#6E6E6E", light: "#767676" },
        description: "Input box foreground color for placeholder text.",
    },
    "input.selectionBackground": {
        // Ранее жил только tuidom-дефолтом (styleTokens) — темы не могли переопределить.
        defaults: { dark: "#264F78", light: "#ADD6FF" },
        description: "Input box background color for selected text.",
    },
    "menubar.selectionForeground": {
        defaults: { dark: "#FFFFFF", light: "#000000" },
        description: "Foreground color of the selected menu item in the menubar.",
    },
    "menubar.selectionBackground": {
        // Исторический цвет активного пункта меню-бара Vexx.
        defaults: { dark: "#005AB4", light: "#0060C0" },
        description: "Background color of the selected menu item in the menubar.",
    },
    "quickInput.foreground": {
        defaults: { dark: "#CCCCCC", light: "#3B3B3B" },
        description: "Quick picker foreground color.",
    },
    "quickInput.background": {
        defaults: { dark: "#252526", light: "#F3F3F3" },
        description: "Quick picker background color.",
    },
    "list.highlightForeground": {
        // Исторический цвет подсветки совпадений Vexx (у VS Code — #2AAAFF).
        defaults: { dark: "#64C8FF", light: "#0066BF" },
        description: "List/Tree foreground color of the match highlights when searching.",
    },
} as const satisfies ColorContribution;
