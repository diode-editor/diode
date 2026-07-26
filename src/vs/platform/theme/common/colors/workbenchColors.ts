import type { ColorContribution } from "../colorRegistry.ts";

/** Части workbench: сайдбар, табы, панель, статус-бар, тайтл-бар, терминал. */
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
    "titleBar.activeBackground": {
        defaults: null,
        description: "Title Bar background when the window is active.",
    },
    "titleBar.activeForeground": {
        defaults: null,
        description: "Title Bar foreground when the window is active.",
    },
    "terminal.background": {
        defaults: { dark: "#181818", light: "#F8F8F8" },
        description: "The background of the Integrated Terminal's viewport.",
    },
    "terminal.foreground": {
        defaults: { dark: "#CCCCCC", light: "#333333" },
        description: "The default foreground color of the Integrated Terminal.",
    },
} as const satisfies ColorContribution;
