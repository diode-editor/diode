import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

export const scmConfiguration: IConfigurationNode = {
    id: "scm",
    title: "Source Control",
    properties: {
        // Читает git-расширение (`refreshLog`): первая страница графа и шаг
        // догрузки по «Load More». Границы 1..1000 (как в vscode) держит само
        // расширение — схема настроек здесь min/max не выражает.
        "scm.graph.pageSize": {
            type: "number",
            default: 50,
            description:
                "The number of commits to load in the Source Control Graph view at a time (clamped to 1..1000).",
        },
    },
};
