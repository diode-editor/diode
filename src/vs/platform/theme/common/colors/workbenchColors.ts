import type { ColorContribution } from "../colorRegistry.ts";

export const workbenchColors = {
    "activityBar.background": {
        defaults: null,
        description: "Activity Bar background color.",
    },
    "activityBar.foreground": {
        defaults: null,
        description: "Activity Bar foreground color (for example used for the icons).",
    },
    "sideBar.background": {
        defaults: { dark: "#252526", light: "#F8F8F8" },
        description: "Side Bar background color.",
    },
    "sideBar.foreground": {
        defaults: { dark: "#CCCCCC", light: "#3B3B3B" },
        description: "Side Bar foreground color.",
    },
    // In vscode both title tokens derive from SIDE_BAR_FOREGROUND; the registry has no derived
    // colors, so the default is duplicated as hex. Keep it in lockstep with "sideBar.foreground".
    "sideBarTitle.foreground": {
        defaults: { dark: "#CCCCCC", light: "#3B3B3B" },
        description: "Side Bar title foreground color.",
    },
    "sideBarSectionHeader.foreground": {
        defaults: { dark: "#CCCCCC", light: "#3B3B3B" },
        description: "Side Bar section header foreground color.",
    },
    "toolbar.hoverBackground": {
        defaults: { dark: "#5A5D5E50", light: "#B8B8B850" },
        description: "Toolbar background when hovering over actions using the mouse.",
    },
    "editorGroup.border": {
        defaults: { dark: "#444444", light: "#E7E7E7" },
        description:
            "Color to separate multiple editor groups from each other. Editor groups are the containers of editors.",
    },
    "editorGroupHeader.tabsBackground": {
        defaults: { dark: "#252526", light: "#F8F8F8" },
        description: "Background color of the Tabs container.",
    },
    "tab.activeBackground": {
        defaults: { dark: "#1E1E1E", light: "#FFFFFF" },
        description: "Active Tab background color in an active group.",
    },
    "tab.activeForeground": {
        defaults: { dark: "#FFFFFF", light: "#3B3B3B" },
        description: "Active Tab foreground color in an active group.",
    },
    "tab.inactiveBackground": {
        defaults: { dark: "#2D2D2D", light: "#F8F8F8" },
        description: "Inactive Tab background color.",
    },
    "tab.inactiveForeground": {
        defaults: { dark: "#FFFFFF80", light: "#868686" },
        description: "Inactive Tab foreground color in an active group.",
    },
    "panel.background": {
        defaults: { dark: "#181818", light: "#F8F8F8" },
        description: "Panel background color.",
    },
    "panel.border": {
        defaults: { dark: "#2B2B2B", light: "#E5E5E5" },
        description: "Panel border color to separate the panel from the editor.",
    },
    "panelTitle.activeBorder": {
        defaults: { dark: "#E7E7E7", light: "#3B3B3B" },
        description: "Border color for the active panel title.",
    },
    "panelTitle.activeForeground": {
        defaults: { dark: "#E7E7E7", light: "#3B3B3B" },
        description: "Title color for the active panel.",
    },
    "panelTitle.inactiveForeground": {
        defaults: { dark: "#8E8E8E", light: "#8C8C8C" },
        description: "Title color for the inactive panel.",
    },
    "statusBar.background": {
        defaults: { dark: "#007ACC", light: "#F8F8F8" },
        description: "Standard Status Bar background color.",
    },
    "statusBar.foreground": {
        defaults: { dark: "#FFFFFF", light: "#3B3B3B" },
        description: "Status Bar foreground color.",
    },
    "statusBarItem.hoverBackground": {
        // The upstream default is white at alpha 0.12; here it is baked over the matching
        // statusBar.background. Themes ship a value with alpha (Dark Modern: "#F1F1F133"), and the
        // engine blends it over the bar background when painting.
        defaults: { dark: "#1E92D2", light: "#E4E4E4" },
        description: "Status Bar item background color when hovering.",
    },
    "statusBarItem.hoverForeground": {
        // Matches the statusBar.foreground defaults: a theme without hoverForeground must not
        // change the text color under the mouse.
        defaults: { dark: "#FFFFFF", light: "#3B3B3B" },
        description: "Status Bar item foreground color when hovering.",
    },
    // VS Code defaults (custom title bar). Our main menu is painted with these colors via the
    // `menuBar.* ← titleBar.active*` bridge in themeStyleVars.ts: VS Code themes have no key of
    // their own for the menu bar.
    "titleBar.activeBackground": {
        defaults: { dark: "#3C3C3C", light: "#DDDDDD" },
        description: "Title Bar background when the window is active.",
    },
    "titleBar.activeForeground": {
        defaults: { dark: "#CCCCCC", light: "#333333" },
        description: "Title Bar foreground when the window is active.",
    },
    // VS Code has no terminal.background default (null): the terminal in the panel uses the panel
    // background, so a theme without terminal colors (Catppuccin) doesn't get a black rectangle in
    // the middle of its panel.
    "terminal.background": {
        defaults: { dark: "panel.background", light: "panel.background" },
        description: "The background of the Integrated Terminal's viewport.",
    },
    "terminal.foreground": {
        defaults: { dark: "#CCCCCC", light: "#333333" },
        description: "The default foreground color of the Integrated Terminal.",
    },
    "terminal.selectionBackground": {
        defaults: { dark: "editor.selectionBackground", light: "editor.selectionBackground" },
        description: "The selection background color of the terminal.",
    },
    // Upstream `transparent(terminal.selectionBackground, 0.5)`: no color expressions here, so it is baked from
    // the `editor.selectionBackground` default; the terminal composites the alpha over the cell's background.
    "terminal.inactiveSelectionBackground": {
        defaults: { dark: "#264F7880", light: "#ADD6FF80" },
        description: "The selection background color of the terminal when it does not have focus.",
    },
    // Upstream defaults to `#000000` in hcDark and `#ffffff` in hcLight only; the registry has no hc slots.
    "terminal.selectionForeground": {
        defaults: null,
        description:
            "The selection foreground color of the terminal. When this is null the selection foreground will be retained and have the minimum contrast ratio feature applied.",
    },
    // Notification toasts (the stack above the status bar). In vscode these three tokens derive
    // from editorWidget.{background,foreground} and notificationCenterHeader.background; the
    // registry has no derived colors, so the defaults are duplicated as hex. Keep them in lockstep
    // with the sources.
    "notifications.background": {
        defaults: { dark: "editorWidget.background", light: "editorWidget.background" },
        description: "Notification toast background color.",
    },
    "notifications.foreground": {
        defaults: { dark: "editorWidget.foreground", light: "editorWidget.foreground" },
        description: "Notification toast foreground color.",
    },
    "notifications.border": {
        defaults: { dark: "#303031", light: "#E7E7E7" },
        description: "Notification toast border color, separating it from other notifications.",
    },
    // Severity accent, also the toast title color. The defaults duplicate
    // editorInfo/editorWarning/editorError.foreground for the same reason.
    "notificationsInfoIcon.foreground": {
        defaults: { dark: "#3794FF", light: "#1A85FF" },
        description: "The color used for the notification info icon.",
    },
    "notificationsWarningIcon.foreground": {
        defaults: { dark: "#CCA700", light: "#BF8803" },
        description: "The color used for the notification warning icon.",
    },
    "notificationsErrorIcon.foreground": {
        defaults: { dark: "#F14C4C", light: "#E51400" },
        description: "The color used for the notification error icon.",
    },
    // Upstream `miscColors.ts`: `Color.black.lighten(0.2)` baked as hex.
    "activityErrorBadge.foreground": {
        defaults: { dark: "#333333", light: "#FFFFFF" },
        description: "Foreground color of the error activity badge",
    },
    "activityErrorBadge.background": {
        defaults: { dark: "#F14C4C", light: "#E51400" },
        description: "Background color of the error activity badge",
    },
    // Upstream `settingsEditorColorRegistry.ts`. Transparent upstream defaults are baked over the editor background.
    "settings.headerForeground": {
        defaults: { dark: "#E7E7E7", light: "#444444" },
        description: "The foreground color for a section header or active title.",
    },
    "settings.modifiedItemIndicator": {
        defaults: { dark: "#0C7D9D", light: "#66AFE0" },
        description: "The color of the modified setting indicator.",
    },
    "settings.headerBorder": {
        defaults: { dark: "#2B2B2B", light: "#E5E5E5" },
        description: "The color of the header container border.",
    },
    "settings.sashBorder": {
        defaults: { dark: "#2B2B2B", light: "#E5E5E5" },
        description: "The color of the Settings editor splitview sash border.",
    },
    "settings.checkboxBackground": {
        defaults: { dark: "#3C3C3C", light: "#FFFFFF" },
        description: "Settings editor checkbox background.",
    },
    "settings.checkboxForeground": {
        defaults: { dark: "#F0F0F0", light: "#616161" },
        description: "Settings editor checkbox foreground.",
    },
    "settings.focusedRowBackground": {
        defaults: { dark: "#232526", light: "#F7F7F7" },
        description: "The background color of a settings row when focused.",
    },
    "settings.rowHoverBackground": {
        defaults: { dark: "#202122", light: "#FBFBFB" },
        description: "The background color of a settings row when hovered.",
    },
    "settings.focusedRowBorder": {
        defaults: { dark: "#007FD4", light: "#0090F1" },
        description: "The color of the row's top and bottom border when the row is focused.",
    },
} as const satisfies ColorContribution;
