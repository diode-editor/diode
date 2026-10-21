import type { ColorContribution } from "../colorRegistry.ts";

/** From vscode (`scmHistory.ts`): five line colors, the IBM colorblind-safe palette, same on dark and light. */
export const scmGraphColors = {
    "scmGraph.foreground1": {
        defaults: { dark: "#FFB000", light: "#FFB000" },
        description: "Source control graph foreground color (1st color).",
    },
    "scmGraph.foreground2": {
        defaults: { dark: "#DC267F", light: "#DC267F" },
        description: "Source control graph foreground color (2nd color).",
    },
    "scmGraph.foreground3": {
        defaults: { dark: "#994F00", light: "#994F00" },
        description: "Source control graph foreground color (3rd color).",
    },
    "scmGraph.foreground4": {
        defaults: { dark: "#40B0A6", light: "#40B0A6" },
        description: "Source control graph foreground color (4th color).",
    },
    "scmGraph.foreground5": {
        defaults: { dark: "#B66DFF", light: "#B66DFF" },
        description: "Source control graph foreground color (5th color).",
    },
    "scmGraph.historyItemRefColor": {
        defaults: { dark: "#3794FF", light: "#1A85FF" },
        description: "History item reference color.",
    },
    "scmGraph.historyItemRemoteRefColor": {
        defaults: { dark: "#B180D7", light: "#652D90" },
        description: "History item remote reference color.",
    },
    "scmGraph.historyItemBaseRefColor": {
        defaults: { dark: "#EA5C00", light: "#EA5C00" },
        description: "History item base reference color.",
    },
} as const satisfies ColorContribution;
