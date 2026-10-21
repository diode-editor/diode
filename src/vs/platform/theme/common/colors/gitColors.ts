import type { ColorContribution } from "../colorRegistry.ts";

export const gitColors = {
    "gitDecoration.addedResourceForeground": {
        defaults: { dark: "#81B88B", light: "#587C0C" },
        description: "Color for added Git resources.",
    },
    "gitDecoration.modifiedResourceForeground": {
        defaults: { dark: "#E2C08D", light: "#895503" },
        description: "Color for modified Git resources.",
    },
    "gitDecoration.deletedResourceForeground": {
        defaults: { dark: "#C74E39", light: "#AD0707" },
        description: "Color for deleted Git resources.",
    },
    "gitDecoration.renamedResourceForeground": {
        defaults: { dark: "#73C991", light: "#007100" },
        description: "Color for renamed or copied Git resources.",
    },
    "gitDecoration.untrackedResourceForeground": {
        defaults: { dark: "#73C991", light: "#007100" },
        description: "Color for untracked Git resources.",
    },
    "gitDecoration.ignoredResourceForeground": {
        defaults: { dark: "#8C8C8C", light: "#8E8E90" },
        description: "Color for ignored Git resources.",
    },
    "gitDecoration.conflictingResourceForeground": {
        defaults: { dark: "#E4676B", light: "#AD0707" },
        description: "Color for conflicting Git resources.",
    },
    "gitDecoration.submoduleResourceForeground": {
        defaults: { dark: "#8DB9E2", light: "#1258A7" },
        description: "Color for submodule resources.",
    },
} as const satisfies ColorContribution;
