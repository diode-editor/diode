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
        "editor.emptySelectionClipboard": {
            type: "boolean",
            default: true,
            description: "Controls whether copying without a selection copies the current line.",
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
            description: "Controls the wrapping column when `editor.wordWrap` is 'wordWrapColumn' or 'bounded'.",
        },
        "editor.formatOnSave": {
            type: "boolean",
            default: false,
            description: "Format a file on save. A formatter must be available (an extension providing it).",
        },
        "editor.inlineSuggest.enabled": {
            type: "boolean",
            default: true,
            description: "Controls whether to automatically show inline suggestions in the editor.",
        },
        // Форма VS Code: объект «kind → включён ли» (`{"source.fixAll": true}`).
        // Значения true | "explicit" | "always" включают вид, false | "never" —
        // выключают; все сохранения diode ручные, так что "explicit" ≡ true.
        "editor.codeActionsOnSave": {
            type: "object",
            default: {},
            description:
                'Code action kinds to be run on save (e.g. `{"source.fixAll": true}`). ' +
                "Kinds match hierarchically: `source.fixAll` also runs `source.fixAll.ruff`.",
        },
    },
};
