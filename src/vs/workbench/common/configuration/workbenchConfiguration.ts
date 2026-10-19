import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";
import { DEFAULT_COLOR_THEME } from "../../services/themes/common/themes/builtinThemes.ts";

export const workbenchConfiguration = {
    id: "workbench",
    title: "Workbench",
    properties: {
        // Активная цветовая тема по имени (label из ThemeRegistry). Дефолт совпадает
        // с out-of-the-box VS Code. Допустимые значения (enum встроенных тем) в
        // каталог автодополнения дописывает генератор схемы — из ThemeRegistry,
        // не отсюда.
        "workbench.colorTheme": {
            scope: "window",
            type: "string",
            default: DEFAULT_COLOR_THEME,
            description: "Specifies the color theme used in the workbench.",
        },
        // Режим предпросмотра вкладок: в группе не больше одной preview-вкладки,
        // и следующее превью её ЗАМЕЩАЕТ. Открытие превью сейчас делает только
        // дерево Explorer — как в эталоне, где `enablePreviewFromQuickOpen` и
        // `enablePreviewFromCodeNavigation` по умолчанию выключены.
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
        // Внешнее удаление файла: по умолчанию вкладка остаётся (зачёркнутой,
        // модель orphaned); `true` — чистая вкладка закрывается. Удаление из
        // самого редактора закрывает чистые вкладки всегда. Читает EditorService.
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
        // Раскрытие папки кликом по имени и Enter (`expandOnlyOnTwistieClick`
        // дерева). Читает Explorer на каждом жесте.
        "workbench.tree.expandMode": {
            scope: "window",
            type: "string",
            enum: ["singleClick", "doubleClick"],
            default: "singleClick",
            description:
                "Controls how tree folders are expanded when clicking the folder names. Note that some trees and " +
                "lists might choose to ignore this setting if it is not applicable.",
        },
        // Видимость вторичной боковой панели в воркспейсе, открытом впервые
        // (сохранённой видимости ещё нет). Читает LayoutService на restore.
        // `maximized*` развёртывания части у нас нет — до него такие значения
        // значат «видима». Пустую часть, как и эталон, не показываем вовсе.
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
