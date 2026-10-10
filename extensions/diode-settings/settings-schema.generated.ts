// GENERATED FILE — не редактировать вручную.
// Регенерируется `npm run build:extensions` (scripts/generate-settings-schema.mjs).
// Каталог известных ключей настроек: configuration-узлы приложения
// (Workbench/Configuration/) + contributes.configuration всех builtin-расширений.
// Вшивается в diode-settings
// на этапе сборки и служит источником автодополнения в settings.json.

export interface ISettingSchemaEntry {
    readonly key: string;
    readonly type?: string;
    readonly default?: unknown;
    readonly description?: string;
    readonly enum?: readonly unknown[];
}

export const SETTINGS_SCHEMA: readonly ISettingSchemaEntry[] = [
    {
        key: "diode.lsp.typescript.enabled",
        type: "boolean",
        default: true,
        description: "Master switch for the built-in TypeScript language server integration.",
    },
    {
        key: "diode.lsp.typescript.serverPath",
        type: "string",
        default: "",
        description:
            "Path to a typescript-language-server executable or its JS entry point. Empty resolves from the workspace node_modules, then PATH.",
    },
    {
        key: "diode.lsp.typescript.tsserverPath",
        type: "string",
        default: "",
        description:
            "Path to typescript/lib/tsserver.js for workspaces without their own TypeScript installation. Empty lets the language server resolve TypeScript itself.",
    },
    {
        key: "editor.codeActionsOnSave",
        type: "object | array",
        default: {},
        description:
            'Code action kinds to be run on save (e.g. `{"source.fixAll": true}`). Kinds match hierarchically: `source.fixAll` also runs `source.fixAll.ruff`.',
    },
    {
        key: "editor.contextmenu",
        type: "boolean",
        default: true,
        description: "Controls whether the editor shows the context menu.",
    },
    {
        key: "editor.cursorSurroundingLines",
        type: "number",
        default: 3,
        description: "Controls the minimal number of visible leading lines around the cursor.",
    },
    {
        key: "editor.detectIndentation",
        type: "boolean",
        default: true,
        description:
            "Controls whether `editor.tabSize` and `editor.insertSpaces` are automatically detected from the file contents when a file is opened.",
    },
    {
        key: "editor.emptySelectionClipboard",
        type: "boolean",
        default: true,
        description: "Controls whether copying without a selection copies the current line.",
    },
    {
        key: "editor.formatOnSave",
        type: "boolean",
        default: false,
        description: "Format a file on save. A formatter must be available (an extension providing it).",
    },
    {
        key: "editor.inlineSuggest.delay",
        type: "number",
        default: 50,
        description:
            "Milliseconds to wait after a change before automatically requesting an inline suggestion. 0 requests on every change; higher values spare a slow or metered provider.",
    },
    {
        key: "editor.inlineSuggest.enabled",
        type: "boolean",
        default: true,
        description: "Controls whether to automatically show inline suggestions in the editor.",
    },
    {
        key: "editor.inlineSuggest.requestTimeout",
        type: "number",
        default: 5000,
        description:
            "Milliseconds to wait for an inline suggestion provider to answer. After that the request is given up on and no suggestion is shown.",
    },
    {
        key: "editor.inlineSuggest.suppressSuggestions",
        type: "boolean",
        default: false,
        description:
            "Controls how inline suggestions interact with the suggest widget. If enabled, the suggest widget is not shown automatically when inline suggestions are available.",
    },
    { key: "editor.insertSpaces", type: "boolean", default: true, description: "Insert spaces when pressing Tab." },
    {
        key: "editor.occurrencesHighlight",
        type: "string",
        default: "singleFile",
        description: "Controls whether the editor highlights semantic symbol occurrences.",
        enum: ["off", "singleFile", "multiFile"],
    },
    {
        key: "editor.quickSuggestions",
        type: "boolean | string | object",
        default: { other: "offWhenInlineCompletions", comments: "off", strings: "off" },
        description:
            "Controls whether suggestions should automatically show up while typing. This can be controlled for typing in comments, strings, and other code. Quick suggestion can be configured to show as ghost text or with the suggest widget. Also be aware of the `#editor.suggestOnTriggerCharacters#`-setting which controls if suggestions are triggered by special characters.",
    },
    {
        key: "editor.quickSuggestionsDelay",
        type: "number",
        default: 10,
        description: "Controls the delay in milliseconds after which quick suggestions will show up.",
    },
    {
        key: "editor.suggestOnTriggerCharacters",
        type: "boolean",
        default: true,
        description: "Controls whether suggestions should automatically show up when typing trigger characters.",
    },
    { key: "editor.tabSize", type: "number", default: 4, description: "The number of spaces a tab is equal to." },
    {
        key: "editor.wordBasedSuggestions",
        type: "string",
        default: "offWithInlineSuggestions",
        description:
            "Controls whether completions should be computed based on words in the document and from which documents they are computed.",
        enum: ["off", "offWithInlineSuggestions", "currentDocument", "matchingDocuments", "allDocuments"],
    },
    {
        key: "editor.wordWrap",
        type: "string",
        default: "off",
        description:
            "Controls how lines should wrap: never ('off'), at the viewport width ('on'), or at `editor.wordWrapColumn` ('wordWrapColumn'/'bounded'; both are capped by the viewport width).",
        enum: ["off", "on", "wordWrapColumn", "bounded"],
    },
    {
        key: "editor.wordWrapColumn",
        type: "number",
        default: 80,
        description: "Controls the wrapping column when `editor.wordWrap` is 'wordWrapColumn' or 'bounded'.",
    },
    {
        key: "explorer.autoReveal",
        type: "boolean",
        default: true,
        description: "Automatically reveal and select the active file in the explorer tree.",
    },
    {
        key: "explorer.compactFolders",
        type: "boolean",
        default: true,
        description:
            "Controls whether the Explorer should render folders in a compact form. In such a form, single child folders will be compressed in a combined tree element. Useful for Java package structures, for example.",
    },
    {
        key: "explorer.confirmDelete",
        type: "boolean",
        default: true,
        description: "Ask for confirmation before deleting a file via the explorer.",
    },
    {
        key: "explorer.confirmUndo",
        type: "boolean",
        default: true,
        description: "Ask for confirmation before undoing a destructive file operation.",
    },
    {
        key: "files.enableTrash",
        type: "boolean",
        default: true,
        description: "Move files to the OS trash when available; when disabled, delete permanently.",
    },
    {
        key: "files.exclude",
        type: "object",
        default: {
            "**/.git": true,
            "**/.svn": true,
            "**/.hg": true,
            "**/.DS_Store": true,
            "**/Thumbs.db": true,
            "**/__pycache__": true,
            "**/.mypy_cache": true,
            "**/.pytest_cache": true,
            "**/.ruff_cache": true,
        },
        description: "Glob patterns to hide from the file tree and from search. Matched relative to the folder.",
    },
    {
        key: "files.watcherExclude",
        type: "object",
        default: {
            "**/.git": true,
            "**/.hg": true,
            "**/.svn": true,
            "**/node_modules": true,
            "**/.venv": true,
            "**/dist": true,
            "**/out": true,
            "**/build": true,
            "**/target": true,
            "**/coverage": true,
            "**/.cache": true,
            "**/.gradle": true,
            "**/.next": true,
            "**/.turbo": true,
            "**/__pycache__": true,
            "**/.mypy_cache": true,
            "**/.pytest_cache": true,
            "**/.ruff_cache": true,
            "**/.stryker-tmp": true,
            "**/.claude/worktrees": true,
        },
        description:
            "Glob patterns to exclude from file watching. Patterns are matched relative to the watched folder.",
    },
    {
        key: "files.watcherInclude",
        type: "array",
        default: [],
        description:
            "Configure extra paths to watch for changes inside the workspace. By default, all workspace folders will be watched recursively, except for folders that are symbolic links. You can explicitly add absolute or relative paths to support watching folders that are symbolic links. Relative paths will be resolved to an absolute path using the currently opened workspace.",
    },
    {
        key: "git.autorefresh",
        type: "boolean",
        default: true,
        description: "Recompute git status automatically when files change on disk.",
    },
    {
        key: "git.decorations.enabled",
        type: "boolean",
        default: true,
        description: "Colour and badge changed files in the explorer tree.",
    },
    {
        key: "git.enabled",
        type: "boolean",
        default: true,
        description: "Master switch for the built-in Git integration.",
    },
    {
        key: "git.gutter.enabled",
        type: "boolean",
        default: true,
        description: "Show dirty-diff change bars in the editor gutter.",
    },
    {
        key: "git.path",
        type: "string",
        default: "",
        description: "Path to a git binary to prefer (its directory is prepended to PATH). Empty uses git from PATH.",
    },
    {
        key: "git.refreshDebounce",
        type: "number",
        default: 200,
        description: "Debounce, in milliseconds, before recomputing git status and diff after a change.",
    },
    {
        key: "keyboard.platform",
        type: "string",
        default: "auto",
        description:
            'Keyboard platform: "auto" detects it (LC_DIODE_PLATFORM, the terminal, the local OS); set it when detection guesses wrong, e.g. over ssh from a Mac.',
        enum: ["auto", "mac", "linux", "windows"],
    },
    {
        key: "scm.graph.pageSize",
        type: "number",
        default: 50,
        description: "The number of commits to load in the Source Control Graph view at a time (clamped to 1..1000).",
    },
    {
        key: "search.exclude",
        type: "object",
        default: {
            "**/node_modules": true,
            "**/bower_components": true,
            "**/.venv": true,
            "**/dist": true,
            "**/out": true,
            "**/build": true,
            "**/target": true,
            "**/coverage": true,
            "**/.next": true,
            "**/.gradle": true,
            "**/.cache": true,
            "**/.turbo": true,
            "**/.stryker-tmp": true,
            "**/.claude/worktrees": true,
        },
        description:
            "Glob patterns to exclude from search, in addition to files.exclude. Matched relative to the folder.",
    },
    {
        key: "task.autoDetect",
        type: "string",
        default: "on",
        description:
            "Controls enablement of `provideTasks` for all task provider extension. If the Tasks: Run Task command is slow, disabling auto detect for task providers may help. Individual extensions may also provide settings that disable auto detection.",
        enum: ["on", "off"],
    },
    {
        key: "task.quickOpen.detail",
        type: "boolean",
        default: true,
        description:
            "Controls whether to show the task detail for tasks that have a detail in task quick picks, such as Run Task.",
    },
    {
        key: "task.quickOpen.skip",
        type: "boolean",
        default: false,
        description: "Controls whether the task quick pick is skipped when there is only one task to pick from.",
    },
    {
        key: "task.saveBeforeRun",
        type: "string",
        default: "always",
        description: "Save all dirty editors before running a task.",
        enum: ["always", "never", "prompt"],
    },
    {
        key: "task.slowProviderWarning",
        type: "boolean | array",
        default: true,
        description: "Configures whether a warning is shown when a provider is slow",
    },
    { key: "task.verboseLogging", type: "boolean", default: false, description: "Enable verbose logging for tasks." },
    {
        key: "terminal.capabilities",
        type: "object",
        default: {},
        description: "Force individual terminal capabilities on or off; empty uses detection.",
    },
    {
        key: "terminal.customModes",
        type: "object",
        default: {},
        description: "Declare custom manual-only terminal modes usable in when-clauses.",
    },
    {
        key: "terminal.integrated.hideOnLastClosed",
        type: "boolean",
        default: true,
        description:
            "Whether to hide the terminal view when the last terminal is closed. This will only happen when the terminal is the only visible view in the view container.",
    },
    {
        key: "terminal.integrated.tabs.enabled",
        type: "boolean",
        default: true,
        description:
            "Controls whether terminal tabs display as a list to the side of the terminal. When this is disabled a dropdown will display instead.",
    },
    {
        key: "terminal.integrated.tabs.focusMode",
        type: "string",
        default: "doubleClick",
        description: "Controls whether focusing the terminal of a tab happens on double or single click.",
        enum: ["singleClick", "doubleClick"],
    },
    {
        key: "terminal.integrated.tabs.hideCondition",
        type: "string",
        default: "singleTerminal",
        description: "Controls whether the terminal tabs view will hide under certain conditions.",
        enum: ["never", "singleTerminal", "singleGroup"],
    },
    {
        key: "terminal.integrated.tabs.location",
        type: "string",
        default: "right",
        description:
            "Controls the location of the terminal tabs, either to the left or right of the actual terminal(s).",
        enum: ["left", "right"],
    },
    {
        key: "terminal.integrated.tabs.showActiveTerminal",
        type: "string",
        default: "singleTerminalOrNarrow",
        description:
            "Shows the active terminal information in the view. This is particularly useful when the title within the tabs aren't visible.",
        enum: ["always", "singleTerminal", "singleTerminalOrNarrow", "never"],
    },
    {
        key: "terminal.modes",
        type: "object",
        default: {},
        description: "Force terminal modes on or off; wins over auto-detection.",
    },
    {
        key: "terminal.tier",
        type: "string",
        default: "auto",
        description: 'Tier override: "auto" detects the terminal capabilities tier.',
        enum: ["auto", "legacy", "csi-u", "kitty"],
    },
    {
        key: "workbench.colorTheme",
        type: "string",
        default: "Dark Modern",
        description: "Specifies the color theme used in the workbench.",
        enum: ["Dark 2026", "Dark Modern", "Dark+", "Monokai", "Light Modern", "Light+"],
    },
    {
        key: "workbench.editor.enablePreview",
        type: "boolean",
        default: true,
        description:
            "Controls whether preview mode is used when editors open. There is a maximum of one preview mode editor per editor group. Its contents will be replaced by the next editor opened in preview mode. Making a change in a preview mode editor will persist it, as will the 'Keep Open' option in its tab context menu.",
    },
];
