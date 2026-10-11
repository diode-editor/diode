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
        // Эталон: editorConfigurationSchema.ts. `configuredByTheme` — флаг
        // `semanticHighlighting` активной темы (у встроенных он включён). `type`
        // у эталона нет (только `enum`); наша схема его требует.
        "editor.semanticHighlighting.enabled": {
            scope: "language-overridable",
            type: ["boolean", "string"],
            enum: [true, false, "configuredByTheme"],
            enumDescriptions: [
                "Semantic highlighting enabled for all color themes.",
                "Semantic highlighting disabled for all color themes.",
                "Semantic highlighting is configured by the current color theme's `semanticHighlighting` setting.",
            ],
            default: "configuredByTheme",
            description: "Controls whether the semanticHighlighting is shown for the languages that support it.",
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
        // Эталон: `editor.inlineSuggest.suppressSuggestions` (editorOptions.ts). Гейт
        // авто-открытия suggest-попапа, пока призрак на экране (`canShowQuickSuggest`).
        "editor.inlineSuggest.suppressSuggestions": {
            scope: "language-overridable",
            type: "boolean",
            default: false,
            description:
                "Controls how inline suggestions interact with the suggest widget. If enabled, the suggest widget is " +
                "not shown automatically when inline suggestions are available.",
        },
        // Эталон: EditorQuickSuggestions (editorOptions.ts). Схема эталона — anyOf
        // boolean | строка-режим | объект `{other, comments, strings}`; у нас anyOf
        // нет, поэтому три типа без enum, а режимы проверяет
        // `readQuickSuggestions` (тот же `validate`, что у эталона: мусор → дефолт).
        "editor.quickSuggestions": {
            scope: "language-overridable",
            type: ["boolean", "string", "object"],
            default: { other: "offWhenInlineCompletions", comments: "off", strings: "off" },
            description:
                "Controls whether suggestions should automatically show up while typing. This can be controlled for " +
                "typing in comments, strings, and other code. Quick suggestion can be configured to show as ghost " +
                "text or with the suggest widget. Also be aware of the `#editor.suggestOnTriggerCharacters#`-setting " +
                "which controls if suggestions are triggered by special characters.",
        },
        "editor.quickSuggestionsDelay": {
            scope: "language-overridable",
            type: "number",
            default: 10,
            minimum: 0,
            // Constants.MAX_SAFE_SMALL_INTEGER эталона (1 << 30).
            maximum: 1073741824,
            description: "Controls the delay in milliseconds after which quick suggestions will show up.",
        },
        "editor.suggestOnTriggerCharacters": {
            scope: "language-overridable",
            type: "boolean",
            default: true,
            description: "Controls whether suggestions should automatically show up when typing trigger characters.",
        },
        // Эталон: editorConfigurationSchema.ts. `offWithInlineSuggestions` там
        // смотрит не на `editor.inlineSuggest.enabled`, а на настройку включения
        // Copilot из product.json (`github.copilot.enable`) — так и у нас, см.
        // `CompletionService.wordBasedSuggestionsOff`.
        "editor.wordBasedSuggestions": {
            scope: "language-overridable",
            type: "string",
            enum: ["off", "offWithInlineSuggestions", "currentDocument", "matchingDocuments", "allDocuments"],
            enumDescriptions: [
                "Turn off Word Based Suggestions.",
                "Turn off Word Based Suggestions when Inline Suggestions are present.",
                "Only suggest words from the active document.",
                "Suggest words from all open documents of the same language.",
                "Suggest words from all open documents.",
            ],
            default: "offWithInlineSuggestions",
            description:
                "Controls whether completions should be computed based on words in the document and from which " +
                "documents they are computed.",
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
