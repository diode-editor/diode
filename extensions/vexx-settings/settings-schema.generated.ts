// GENERATED FILE — не редактировать вручную.
// Регенерируется `npm run build:extensions` (scripts/generate-settings-schema.mjs).
// Каталог известных ключей настроек: configuration-узлы приложения
// (Workbench/Configuration/) + contributes.configuration всех builtin-расширений.
// Вшивается в vexx-settings
// на этапе сборки и служит источником автодополнения в settings.json.

export interface ISettingSchemaEntry {
    readonly key: string;
    readonly type?: string;
    readonly default?: unknown;
    readonly description?: string;
    readonly enum?: readonly unknown[];
}

export const SETTINGS_SCHEMA: readonly ISettingSchemaEntry[] = [
    {"key":"editor.contextmenu","type":"boolean","default":true,"description":"Controls whether the editor shows the context menu."},
    {"key":"editor.cursorSurroundingLines","type":"number","default":3,"description":"Controls the minimal number of visible leading lines around the cursor."},
    {"key":"editor.insertSpaces","type":"boolean","default":true,"description":"Insert spaces when pressing Tab."},
    {"key":"editor.tabSize","type":"number","default":4,"description":"The number of spaces a tab is equal to."},
    {"key":"explorer.autoReveal","type":"boolean","default":true,"description":"Automatically reveal and select the active file in the explorer tree."},
    {"key":"explorer.confirmDelete","type":"boolean","default":true,"description":"Ask for confirmation before deleting a file via the explorer."},
    {"key":"explorer.confirmUndo","type":"boolean","default":true,"description":"Ask for confirmation before undoing a destructive file operation."},
    {"key":"files.enableTrash","type":"boolean","default":true,"description":"Move files to the OS trash when available; when disabled, delete permanently."},
    {"key":"git.decorations.enabled","type":"boolean","default":true,"description":"Colour and badge changed files in the explorer tree."},
    {"key":"git.enabled","type":"boolean","default":true,"description":"Master switch for the built-in Git integration."},
    {"key":"git.gutter.enabled","type":"boolean","default":true,"description":"Show dirty-diff change bars in the editor gutter."},
    {"key":"git.path","type":"string","default":"","description":"Path to a git binary to prefer (its directory is prepended to PATH). Empty uses git from PATH."},
    {"key":"git.refreshDebounce","type":"number","default":200,"description":"Debounce, in milliseconds, before recomputing git status and diff after a change."},
    {"key":"scm.graph.pageSize","type":"number","default":50,"description":"The number of commits to load in the Source Control Graph view at a time (clamped to 1..1000)."},
    {"key":"terminal.capabilities","type":"object","default":{},"description":"Force individual terminal capabilities on or off; empty uses detection."},
    {"key":"terminal.customModes","type":"object","default":{},"description":"Declare custom manual-only terminal modes usable in when-clauses."},
    {"key":"terminal.modes","type":"object","default":{},"description":"Force terminal modes on or off; wins over auto-detection."},
    {"key":"terminal.tier","type":"string","default":"auto","description":"Tier override: \"auto\" detects the terminal capabilities tier.","enum":["auto","legacy","csi-u","kitty"]},
    {"key":"vexx.lsp.typescript.enabled","type":"boolean","default":true,"description":"Master switch for the built-in TypeScript language server integration."},
    {"key":"vexx.lsp.typescript.serverPath","type":"string","default":"","description":"Path to a typescript-language-server executable or its JS entry point. Empty resolves from the workspace node_modules, then PATH."},
    {"key":"vexx.lsp.typescript.tsserverPath","type":"string","default":"","description":"Path to typescript/lib/tsserver.js for workspaces without their own TypeScript installation. Empty lets the language server resolve TypeScript itself."},
    {"key":"workbench.colorTheme","type":"string","default":"Dark Modern","description":"Specifies the color theme used in the workbench.","enum":["Dark 2026","Dark Modern","Dark+","Monokai","Light Modern","Light+"]},
];
