import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";
import { DEFAULT_COLOR_THEME } from "../../services/themes/common/themes/builtinThemes.ts";

export const workbenchConfiguration = {
    id: "workbench",
    title: "Workbench",
    properties: {
        // The schema generator adds the enum of built-in themes from ThemeRegistry to the completion catalog.
        "workbench.colorTheme": {
            scope: "window",
            type: "string",
            default: DEFAULT_COLOR_THEME,
            description: "Specifies the color theme used in the workbench.",
        },
        // Only the Explorer opens previews: upstream's `enablePreviewFromQuickOpen` and
        // `enablePreviewFromCodeNavigation` are off by default.
        "workbench.editor.enablePreview": {
            scope: "window",
            type: "boolean",
            default: true,
            description:
                "Controls whether preview mode is used when editors open. There is a maximum of one preview " +
                "mode editor per editor group. Its contents will be replaced by the next editor opened in " +
                "preview mode. Making a change in a preview mode editor will persist it, as will the " +
                "'Keep Open' option in its tab context menu.",
        },
        // We have no window title, so `titleBar` hides the editor actions, like upstream without a custom title bar.
        "workbench.editor.editorActionsLocation": {
            scope: "window",
            type: "string",
            default: "default",
            enum: ["default", "titleBar", "hidden"],
            enumDescriptions: [
                "Show editor actions in the window title bar when `#workbench.editor.showTabs#` is set to `none`. Otherwise, editor actions are shown in the editor tab bar.",
                "Show editor actions in the window title bar. If `#window.customTitleBarVisibility#` is set to `never`, editor actions are hidden.",
                "Editor actions are not shown.",
            ],
            description: "Controls where the editor actions are shown.",
        },
        "workbench.editor.closeOnFileDelete": {
            scope: "window",
            type: "boolean",
            default: false,
            description:
                "Controls whether editors showing a file that was opened during the session should close " +
                "automatically when getting deleted or renamed by some other process. Disabling this will keep " +
                "the editor open  on such an event. Note that deleting from within the application will always " +
                "close the editor and that editors with unsaved changes will never close to preserve your data.",
        },
        "workbench.tree.expandMode": {
            scope: "window",
            type: "string",
            enum: ["singleClick", "doubleClick"],
            default: "singleClick",
            description:
                "Controls how tree folders are expanded when clicking the folder names. Note that some trees and " +
                "lists might choose to ignore this setting if it is not applicable.",
        },
        // We can't maximize a part, so `maximized*` means "visible". Like upstream, an empty part is not shown.
        "workbench.secondarySideBar.defaultVisibility": {
            scope: "window",
            type: "string",
            enum: ["hidden", "visibleInWorkspace", "visible", "maximizedInWorkspace", "maximized"],
            default: "visibleInWorkspace",
            description:
                "Controls the default visibility of the secondary side bar in workspaces or empty windows that are " +
                "opened for the first time. Can be overridden by the agent sessions startup editor setting.",
            enumDescriptions: [
                "The secondary side bar is hidden by default.",
                "The secondary side bar is visible by default if a workspace is opened.",
                "The secondary side bar is visible by default.",
                "The secondary side bar is visible and maximized by default if a workspace is opened.",
                "The secondary side bar is visible and maximized by default.",
            ],
        },
    },
} as const satisfies IConfigurationNode;
