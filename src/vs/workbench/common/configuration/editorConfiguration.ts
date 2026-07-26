import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

export const editorConfiguration: IConfigurationNode = {
    id: "editor",
    title: "Editor",
    properties: {
        "editor.tabSize": {
            type: "number",
            default: 4,
            description: "The number of spaces a tab is equal to.",
        },
        "editor.insertSpaces": {
            type: "boolean",
            default: true,
            description: "Insert spaces when pressing Tab.",
        },
        // В VS Code дефолт 0; здесь держим небольшой отступ (issue #89) — курсор
        // «оттупает» от края при прокрутке его в видимую область (PgUp/PgDown, Ctrl+End).
        "editor.cursorSurroundingLines": {
            type: "number",
            default: 3,
            description: "Controls the minimal number of visible leading lines around the cursor.",
        },
        "editor.contextmenu": {
            type: "boolean",
            default: true,
            description: "Controls whether the editor shows the context menu.",
        },
        // editor.detectIndentation — добавим, когда редактор станет читать её из конфига.
    },
};
