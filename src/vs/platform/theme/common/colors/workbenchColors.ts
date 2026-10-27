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
} as const satisfies ColorContribution;
