import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

export const scmConfiguration = {
    id: "scm",
    title: "Source Control",
    properties: {
        // Границы 1..1000 держит git-расширение (`refreshLog`): схема min/max здесь не выражает.
        "scm.graph.pageSize": {
            scope: "resource",
            type: "number",
            default: 50,
            description:
                "The number of commits to load in the Source Control Graph view at a time (clamped to 1..1000).",
        },
    },
} as const satisfies IConfigurationNode;
