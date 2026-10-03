import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

export const editorConfiguration = {
    id: "editor",
    title: "Editor",
    properties: {
        "editor.tabSize": {
            scope: "language-overridable",
            type: "number",
            default: 4,
            description: "The number of spaces a tab is equal to.",
        },
        "editor.insertSpaces": {
            scope: "language-overridable",
            type: "boolean",
            default: true,
            description: "Insert spaces when pressing Tab.",
        },
        "editor.detectIndentation": {
            scope: "language-overridable",
            type: "boolean",
            default: true,
            description:
                "Controls whether `editor.tabSize` and `editor.insertSpaces` are automatically detected " +
                "from the file contents when a file is opened.",
        },
        // В VS Code дефолт 0; здесь держим небольшой отступ (issue #89) — курсор
        // «оттупает» от края при прокрутке его в видимую область (PgUp/PgDown, Ctrl+End).
        "editor.cursorSurroundingLines": {
            scope: "language-overridable",
            type: "number",
            default: 3,
            description: "Controls the minimal number of visible leading lines around the cursor.",
        },
        // Как в VS Code: "off" гасит подсветку вхождений. Область "multiFile" у нас
        // не поддержана и ведёт себя как "singleFile".
        "editor.occurrencesHighlight": {
            scope: "language-overridable",
            type: "string",
            enum: ["off", "singleFile", "multiFile"],
            default: "singleFile",
            description: "Controls whether the editor highlights semantic symbol occurrences.",
        },
        "editor.emptySelectionClipboard": {
            scope: "language-overridable",
            type: "boolean",
            default: true,
            description: "Controls whether copying without a selection copies the current line.",
        },
        "editor.contextmenu": {
            scope: "language-overridable",
            type: "boolean",
            default: true,
            description: "Controls whether the editor shows the context menu.",
        },
        "editor.wordWrap": {
            scope: "language-overridable",
            type: "string",
            enum: ["off", "on", "wordWrapColumn", "bounded"],
            default: "off",
            description:
                "Controls how lines should wrap: never ('off'), at the viewport width ('on'), or at " +
                "`editor.wordWrapColumn` ('wordWrapColumn'/'bounded'; both are capped by the viewport width).",
        },
        "editor.wordWrapColumn": {
            scope: "language-overridable",
            type: "number",
            default: 80,
            description: "Controls the wrapping column when `editor.wordWrap` is 'wordWrapColumn' or 'bounded'.",
        },
        "editor.formatOnSave": {
            scope: "language-overridable",
            type: "boolean",
            default: false,
            description: "Format a file on save. A formatter must be available (an extension providing it).",
        },
        // Как в VS Code, ключ гейтит ТОЛЬКО автозапрос: команда
        // `editor.action.inlineSuggest.trigger` (Alt+\) работает и при `false` —
        // это и есть «ручной режим».
        "editor.inlineSuggest.enabled": {
            scope: "language-overridable",
            type: "boolean",
            default: true,
            description: "Controls whether to automatically show inline suggestions in the editor.",
        },
        // Наши ключи в vscode-неймспейсе (в upstream дебаунс адаптивный и зашит
        // константой, а таймаута ответа нет вовсе — там CancellationToken).
        // Имя `delay` — по образцу `editor.quickSuggestionsDelay`.
        "editor.inlineSuggest.delay": {
            scope: "language-overridable",
            type: "number",
            default: 50,
            minimum: 0,
            description:
                "Milliseconds to wait after a change before automatically requesting an inline suggestion. " +
                "0 requests on every change; higher values spare a slow or metered provider.",
        },
        "editor.inlineSuggest.requestTimeout": {
            scope: "language-overridable",
            type: "number",
            default: 5000,
            minimum: 1,
            description:
                "Milliseconds to wait for an inline suggestion provider to answer. " +
                "After that the request is given up on and no suggestion is shown.",
        },
        // Форма VS Code: объект «kind → включён ли» (`{"source.fixAll": true}`).
        // Значения true | "explicit" | "always" включают вид, false | "never" —
        // выключают; все сохранения diode ручные, так что "explicit" ≡ true.
        "editor.codeActionsOnSave": {
            scope: "language-overridable",
            // Как у VS Code: объект «kind → включён» или массив включённых видов.
            type: ["object", "array"],
            default: {},
            description:
                'Code action kinds to be run on save (e.g. `{"source.fixAll": true}`). ' +
                "Kinds match hierarchically: `source.fixAll` also runs `source.fixAll.ruff`.",
        },
    },
} as const satisfies IConfigurationNode;
