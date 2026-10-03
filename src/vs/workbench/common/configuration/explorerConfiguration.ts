import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

export const explorerConfiguration = {
    id: "explorer",
    title: "File Explorer",
    properties: {
        // Безвозвратное удаление спрашивает подтверждение всегда, независимо от значения.
        "explorer.confirmDelete": {
            scope: "window",
            type: "boolean",
            default: true,
            description: "Ask for confirmation before deleting a file via the explorer.",
        },
        "explorer.confirmUndo": {
            scope: "window",
            type: "boolean",
            default: true,
            description: "Ask for confirmation before undoing a destructive file operation.",
        },
        "explorer.autoReveal": {
            scope: "window",
            type: "boolean",
            default: true,
            description: "Automatically reveal and select the active file in the explorer tree.",
        },
    },
} as const satisfies IConfigurationNode;
