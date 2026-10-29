import type { ColorContribution } from "../colorRegistry.ts";

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
    // Upstream: `tree.inactiveIndentGuidesStroke` is `transparent(tree.indentGuidesStroke, 0.4)`, baked as hex.
    "tree.indentGuidesStroke": {
        defaults: { dark: "#585858", light: "#a9a9a9" },
        description: "Tree stroke color for the indentation guides.",
    },
    "tree.inactiveIndentGuidesStroke": {
        defaults: { dark: "#58585866", light: "#a9a9a966" },
        description: "Tree stroke color for the indentation guides that are not active.",
    },
    "list.errorForeground": {
        defaults: { dark: "#F88070", light: "#B01011" },
        description: "Foreground color of list items containing errors.",
    },
    // Values come from the VS Code registry (`colorRegistry.ts`); `dropdown.listBackground` is
    // `null` there (inherits editorWidget.background), so we take what our imported themes ship.
    "dropdown.background": {
        defaults: { dark: "#3C3C3C", light: "#FFFFFF" },
        description: "Dropdown background.",
    },
    "dropdown.foreground": {
        defaults: { dark: "#F0F0F0", light: "foreground" },
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
    // Derived as in the VS Code registry: the menu inherits dropdown.*, the item selection
    // inherits list.activeSelection*.
    "menu.foreground": {
        defaults: { dark: "dropdown.foreground", light: "dropdown.foreground" },
        description: "Foreground color of menu items.",
    },
    "menu.background": {
        defaults: { dark: "dropdown.background", light: "dropdown.background" },
        description: "Background color of menu items.",
    },
    "menu.selectionForeground": {
        defaults: { dark: "list.activeSelectionForeground", light: "list.activeSelectionForeground" },
        description: "Foreground color of the selected menu item in menus.",
    },
    "menu.selectionBackground": {
        defaults: { dark: "list.activeSelectionBackground", light: "list.activeSelectionBackground" },
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
    // Values come from the VS Code registry (`colorRegistry.ts`), except the marked ones: there
    // our historical defaults keep the built-in themes looking 1:1 (N3).
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
        // Historical Diode placeholder color (VS Code uses #989898 over transparency).
        defaults: { dark: "#6E6E6E", light: "#767676" },
        description: "Input box foreground color for placeholder text.",
    },
    "input.selectionBackground": {
        defaults: { dark: "#264F78", light: "#ADD6FF" },
        description: "Input box background color for selected text.",
    },
    "menubar.selectionForeground": {
        defaults: { dark: "#FFFFFF", light: "#000000" },
        description: "Foreground color of the selected menu item in the menubar.",
    },
    "menubar.selectionBackground": {
        // Historical Diode color of the active menu bar item.
        defaults: { dark: "#005AB4", light: "#0060C0" },
        description: "Background color of the selected menu item in the menubar.",
    },
    // Derived from editorWidget.*, as in the VS Code registry: a theme that sets the widget
    // background (Catppuccin: #181825) paints the picker with it too.
    "quickInput.foreground": {
        defaults: { dark: "editorWidget.foreground", light: "editorWidget.foreground" },
        description: "Quick picker foreground color.",
    },
    "quickInput.background": {
        defaults: { dark: "editorWidget.background", light: "editorWidget.background" },
        description: "Quick picker background color.",
    },
    // VS Code has no picker colors of its own; the border matches the other widgets (find, hover),
    // where VS Code uses a shadow instead.
    "quickPick.border": {
        defaults: { dark: "editorWidget.border", light: "editorWidget.border" },
        description: "Quick picker frame color.",
    },
    "quickPick.titleForeground": {
        defaults: { dark: "#E6E6E6", light: "#1F1F1F" },
        description: "Quick picker title color (inlaid into the top frame).",
    },
    "quickPick.promptForeground": {
        defaults: { dark: "#8C8C8C", light: "#6C6C6C" },
        description: "Quick picker prompt line color (under the query).",
    },
    "quickPick.badgeForeground": {
        defaults: { dark: "#96BE64", light: "#4C7A1E" },
        description: "Quick picker item badge color, e.g. the recently-used marker.",
    },
    "quickPick.shortcutForeground": {
        defaults: { dark: "#808080", light: "#717171" },
        description: "Quick picker item keybinding color.",
    },
    "quickPick.hintForeground": {
        defaults: { dark: "#6496C8", light: "#1F6FB2" },
        description: "Quick picker item action hint color.",
    },
    "list.highlightForeground": {
        // Historical Diode match highlight color (VS Code uses #2AAAFF).
        defaults: { dark: "#64C8FF", light: "#0066BF" },
        description: "List/Tree foreground color of the match highlights when searching.",
    },
} as const satisfies ColorContribution;
