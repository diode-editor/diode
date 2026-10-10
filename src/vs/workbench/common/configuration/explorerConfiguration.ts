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
        // Сжатая цепочка — одна метка «a/b/c»: выбирать её сегменты по
        // отдельности (как в эталоне) не умеем, действия бьют в последнюю папку.
        "explorer.compactFolders": {
            scope: "window",
            type: "boolean",
            description:
                "Controls whether the Explorer should render folders in a compact form. In such a form, single child folders will be compressed in a combined tree element. Useful for Java package structures, for example.",
            default: true,
        },
    },
} as const satisfies IConfigurationNode;
