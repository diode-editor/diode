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
        "explorer.openEditors.visible": {
            scope: "window",
            type: "number",
            description:
                "The initial maximum number of editors shown in the Open Editors pane. Exceeding this limit will show a scroll bar and allow resizing the pane to display more items.",
            default: 9,
            minimum: 1,
        },
        "explorer.openEditors.minVisible": {
            scope: "window",
            type: "number",
            description:
                "The minimum number of editor slots pre-allocated in the Open Editors pane. If set to 0 the Open Editors pane will dynamically resize based on the number of editors.",
            default: 0,
            minimum: 0,
        },
        "explorer.openEditors.sortOrder": {
            scope: "window",
            type: "string",
            enum: ["editorOrder", "alphabetical", "fullPath"],
            description: "Controls the sorting order of editors in the Open Editors pane.",
            enumDescriptions: [
                "Editors are ordered in the same order editor tabs are shown.",
                "Editors are ordered alphabetically by tab name inside each editor group.",
                "Editors are ordered alphabetically by full path inside each editor group.",
            ],
            default: "editorOrder",
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
