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
        "editor.detectIndentation": {
            type: "boolean",
            default: true,
            description:
                "Controls whether `editor.tabSize` and `editor.insertSpaces` are automatically detected " +
                "from the file contents when a file is opened.",
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
        "editor.wordWrap": {
            type: "string",
            enum: ["off", "on", "wordWrapColumn", "bounded"],
            default: "off",
            description:
                "Controls how lines should wrap: never ('off'), at the viewport width ('on'), or at " +
                "`editor.wordWrapColumn` ('wordWrapColumn'/'bounded'; both are capped by the viewport width).",
        },
        "editor.wordWrapColumn": {
            type: "number",
            default: 80,
            description:
                "Controls the wrapping column when `editor.wordWrap` is 'wordWrapColumn' or 'bounded'.",
        },
    },
};
