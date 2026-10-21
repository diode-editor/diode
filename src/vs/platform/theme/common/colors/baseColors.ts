import type { ColorContribution } from "../colorRegistry.ts";

export const baseColors = {
    focusBorder: {
        defaults: { dark: "#007FD4", light: "#0090F1" },
        description:
            "Overall border color for focused elements. This color is only used if not overridden by a component.",
    },
    foreground: {
        defaults: { dark: "#CCCCCC", light: "#3B3B3B" },
        description: "Overall foreground color. This color is only used if not overridden by a component.",
    },
    // Dark — opaque approximation of VS Code's #CCCCCCB3 over the widget bg.
    descriptionForeground: {
        defaults: { dark: "#ABABAB", light: "#717171" },
        description: "Foreground color for description text providing additional information, for example for a label.",
    },
    // Opaque approximations of VS Code's #CCCCCC80 / #61616180.
    disabledForeground: {
        defaults: { dark: "#767676", light: "#ACACAC" },
        description: "Overall foreground for disabled elements. This color is only used if not overridden.",
    },
    "sash.hoverBorder": {
        defaults: { dark: "#007FD4", light: "#0090F1" },
        description: "The hover border color for draggable sashes.",
    },
    "textLink.foreground": {
        defaults: { dark: "#3794FF", light: "#006AB1" },
        description: "Foreground color for links in text.",
    },
} as const satisfies ColorContribution;
