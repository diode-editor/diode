import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

export const explorerConfiguration = {
    id: "explorer",
    title: "File Explorer",
    properties: {
        // Permanent deletion always asks for confirmation, regardless of the value.
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
        // A compacted chain is a single "a/b/c" label: we can't select its segments
        // individually (as upstream does), so actions target the last folder.
        "explorer.compactFolders": {
            scope: "window",
            type: "boolean",
            description:
                "Controls whether the Explorer should render folders in a compact form. In such a form, single child folders will be compressed in a combined tree element. Useful for Java package structures, for example.",
            default: true,
        },
        // Without colors the badge uses the row color: the tree has one color for both name and badge.
        "explorer.decorations.colors": {
            scope: "window",
            type: "boolean",
            description: "Controls whether file decorations should use colors.",
            default: true,
        },
        "explorer.decorations.badges": {
            scope: "window",
            type: "boolean",
            description: "Controls whether file decorations should use badges.",
            default: true,
        },
    },
} as const satisfies IConfigurationNode;
