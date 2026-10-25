import type { ColorContribution } from "../colorRegistry.ts";

/**
 * Upstream `chartsColors.ts`. Extensions tint tree icons with them (`new ThemeIcon("x", new
 * ThemeColor("charts.red"))`). `charts.lines` is left out: it is a translucent foreground, and the
 * registry has no alpha.
 */
export const chartsColors = {
    "charts.foreground": {
        defaults: { dark: "foreground", light: "foreground" },
        description: "The foreground color used in charts.",
    },
    "charts.red": {
        defaults: { dark: "editorError.foreground", light: "editorError.foreground" },
        description: "The red color used in chart visualizations.",
    },
    // Upstream's `editorInfoForeground` default today; our `editorInfo.foreground` is still the older one.
    "charts.blue": {
        defaults: { dark: "#59A4F9", light: "#0063D3" },
        description: "The blue color used in chart visualizations.",
    },
    "charts.yellow": {
        defaults: { dark: "editorWarning.foreground", light: "editorWarning.foreground" },
        description: "The yellow color used in chart visualizations.",
    },
    // Upstream refers to `minimap.findMatchHighlight`, which has no other consumer here.
    "charts.orange": {
        defaults: { dark: "#D18616", light: "#D18616" },
        description: "The orange color used in chart visualizations.",
    },
    "charts.green": {
        defaults: { dark: "#89D185", light: "#388A34" },
        description: "The green color used in chart visualizations.",
    },
    "charts.purple": {
        defaults: { dark: "#B180D7", light: "#652D90" },
        description: "The purple color used in chart visualizations.",
    },
} as const satisfies ColorContribution;
