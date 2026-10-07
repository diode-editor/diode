import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

export const terminalConfiguration = {
    id: "terminal",
    title: "Terminal",
    properties: {
        "terminal.tier": {
            scope: "machine",
            type: "string",
            default: "auto",
            enum: ["auto", "legacy", "csi-u", "kitty"],
            description: 'Tier override: "auto" detects the terminal capabilities tier.',
        },
        // ОС клавиатуры (не процесса): по ssh с мака раскладка должна быть маковской.
        "keyboard.platform": {
            scope: "machine",
            type: "string",
            default: "auto",
            enum: ["auto", "mac", "linux", "windows"],
            description:
                'Keyboard platform: "auto" detects it (LC_DIODE_PLATFORM, the terminal, the local OS); set it when detection guesses wrong, e.g. over ssh from a Mac.',
        },
        // Capability force-overrides, e.g. { "osc52": false }. Empty = use detection.
        "terminal.capabilities": {
            scope: "machine",
            type: "object",
            default: {},
            description: "Force individual terminal capabilities on or off; empty uses detection.",
        },
        // Force modes on/off, e.g. { "ssh": true }. Wins over auto-detection.
        "terminal.modes": {
            scope: "machine",
            type: "object",
            default: {},
            description: "Force terminal modes on or off; wins over auto-detection.",
        },
        // Declare custom manual-only modes, e.g. { "presentation": {} } — usable in `when`.
        "terminal.customModes": {
            scope: "window",
            type: "object",
            default: {},
            description: "Declare custom manual-only terminal modes usable in when-clauses.",
        },
        // Встроенный терминал: вкладки терминалов — ключи, дефолты, enum и
        // описания дословно из `terminalConfiguration.ts` эталона (узел
        // `terminal.integrated`). Не поддержанные ключи названы в
        // docs/TODO/IntegratedTerminal.md.
        "terminal.integrated.tabs.enabled": {
            scope: "window",
            type: "boolean",
            default: true,
            description:
                "Controls whether terminal tabs display as a list to the side of the terminal. When this is disabled a dropdown will display instead.",
        },
        "terminal.integrated.tabs.hideCondition": {
            scope: "window",
            type: "string",
            default: "singleTerminal",
            enum: ["never", "singleTerminal", "singleGroup"],
            enumDescriptions: [
                "Never hide the terminal tabs view",
                "Hide the terminal tabs view when there is only a single terminal opened",
                "Hide the terminal tabs view when there is only a single terminal group opened",
            ],
            description: "Controls whether the terminal tabs view will hide under certain conditions.",
        },
        "terminal.integrated.tabs.showActiveTerminal": {
            scope: "window",
            type: "string",
            default: "singleTerminalOrNarrow",
            enum: ["always", "singleTerminal", "singleTerminalOrNarrow", "never"],
            enumDescriptions: [
                "Always show the active terminal",
                "Show the active terminal when it is the only terminal opened",
                "Show the active terminal when it is the only terminal opened or when the tabs view is in its narrow textless state",
                "Never show the active terminal",
            ],
            description:
                "Shows the active terminal information in the view. This is particularly useful when the title within the tabs aren't visible.",
        },
        "terminal.integrated.tabs.location": {
            scope: "window",
            type: "string",
            default: "right",
            enum: ["left", "right"],
            enumDescriptions: [
                "Show the terminal tabs view to the left of the terminal",
                "Show the terminal tabs view to the right of the terminal",
            ],
            description:
                "Controls the location of the terminal tabs, either to the left or right of the actual terminal(s).",
        },
        "terminal.integrated.tabs.focusMode": {
            scope: "window",
            type: "string",
            default: "doubleClick",
            enum: ["singleClick", "doubleClick"],
            enumDescriptions: [
                "Focus the terminal when clicking a terminal tab",
                "Focus the terminal when double-clicking a terminal tab",
            ],
            description: "Controls whether focusing the terminal of a tab happens on double or single click.",
        },
        "terminal.integrated.hideOnLastClosed": {
            scope: "window",
            type: "boolean",
            default: true,
            description:
                "Whether to hide the terminal view when the last terminal is closed. This will only happen when the terminal is the only visible view in the view container.",
        },
    },
} as const satisfies IConfigurationNode;
