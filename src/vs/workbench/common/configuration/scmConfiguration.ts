import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

export const scmConfiguration = {
    id: "scm",
    title: "Source Control",
    properties: {
        // The git extension enforces the 1..1000 bounds (`refreshLog`): the schema can't express min/max here.
        "scm.graph.pageSize": {
            scope: "resource",
            type: "number",
            default: 50,
            description:
                "The number of commits to load in the Source Control Graph view at a time (clamped to 1..1000).",
        },
    },
} as const satisfies IConfigurationNode;
