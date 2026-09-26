import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

export const terminalConfiguration: IConfigurationNode = {
    id: "terminal",
    title: "Terminal",
    properties: {
        "terminal.tier": {
            type: "string",
            default: "auto",
            enum: ["auto", "legacy", "csi-u", "kitty"],
            description: 'Tier override: "auto" detects the terminal capabilities tier.',
        },
        // ОС клавиатуры (не процесса): по ssh с мака раскладка должна быть маковской.
        "keyboard.platform": {
            type: "string",
            default: "auto",
            enum: ["auto", "mac", "linux", "windows"],
            description:
                'Keyboard platform: "auto" detects it (LC_DIODE_PLATFORM, the terminal, the local OS); set it when detection guesses wrong, e.g. over ssh from a Mac.',
        },
        // Capability force-overrides, e.g. { "osc52": false }. Empty = use detection.
        "terminal.capabilities": {
            type: "object",
            default: {},
            description: "Force individual terminal capabilities on or off; empty uses detection.",
        },
        // Force modes on/off, e.g. { "ssh": true }. Wins over auto-detection.
        "terminal.modes": {
            type: "object",
            default: {},
            description: "Force terminal modes on or off; wins over auto-detection.",
        },
        // Declare custom manual-only modes, e.g. { "presentation": {} } — usable in `when`.
        "terminal.customModes": {
            type: "object",
            default: {},
            description: "Declare custom manual-only terminal modes usable in when-clauses.",
        },
    },
};
