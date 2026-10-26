import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

import { DEFAULT_COMMANDS_TO_SKIP_SHELL } from "./terminalCommandsToSkipShell.ts";

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
        "keyboard.platform": {
            scope: "machine",
            type: "string",
            default: "auto",
            enum: ["auto", "mac", "linux", "windows"],
            description:
                'Keyboard platform: "auto" detects it (LC_DIODE_PLATFORM, the terminal, the local OS); set it when detection guesses wrong, e.g. over ssh from a Mac.',
        },
        // Ours: vscode ships its codicon font. The `null` of `workbench.iconTheme` is the nearest upstream analogue.
        "diode.icons.nerdFont": {
            scope: "application",
            type: "string",
            default: "auto",
            enum: ["auto", "on", "off"],
            enumDescriptions: [
                "Use Nerd Font glyphs unless the terminal is known to lack them (the Linux console).",
                "Always use Nerd Font glyphs.",
                "Never use Nerd Font glyphs.",
            ],
            description:
                "Controls whether icons are drawn with Nerd Font glyphs. Use `off` when the terminal font has no Nerd Font symbols: icons fall back to plain Unicode characters and file icons are hidden.",
        },
        "terminal.capabilities": {
            scope: "machine",
            type: "object",
            default: {},
            description: "Force individual terminal capabilities on or off; empty uses detection.",
        },
        "terminal.modes": {
            scope: "machine",
            type: "object",
            default: {},
            description: "Force terminal modes on or off; wins over auto-detection.",
        },
        "terminal.customModes": {
            scope: "window",
            type: "object",
            default: {},
            description: "Declare custom manual-only terminal modes usable in when-clauses.",
        },
        // `terminal.integrated.*` is verbatim from upstream; unsupported keys are in docs/arch/workbench/Terminal.md.
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
        "terminal.integrated.defaultLocation": {
            scope: "window",
            type: "string",
            default: "view",
            enum: ["editor", "view"],
            enumDescriptions: ["Create terminals in the editor", "Create terminals in the terminal view"],
            description: "Controls where newly created terminals will appear.",
        },
        "terminal.integrated.hideOnLastClosed": {
            scope: "window",
            type: "boolean",
            default: true,
            description:
                "Whether to hide the terminal view when the last terminal is closed. This will only happen when the terminal is the only visible view in the view container.",
        },
        // Keys while the terminal has focus: `terminalKeyRouting.ts`. Our schema can't express `items: string`.
        "terminal.integrated.sendKeybindingsToShell": {
            scope: "window",
            type: "boolean",
            default: false,
            description:
                "Dispatches most keybindings to the terminal instead of the workbench, overriding `#terminal.integrated.commandsToSkipShell#`, which can be used alternatively for fine tuning.",
        },
        "terminal.integrated.commandsToSkipShell": {
            scope: "window",
            type: "array",
            default: [],
            description: `A set of command IDs whose keybindings will not be sent to the shell but instead always be handled by VS Code. This allows keybindings that would normally be consumed by the shell to act instead the same as when the terminal is not focused, for example \`Ctrl+P\` to launch Quick Open.\n\n&nbsp;\n\nMany commands are skipped by default. To override a default and pass that command's keybinding to the shell instead, add the command prefixed with the \`-\` character. For example add \`-workbench.action.quickOpen\` to allow \`Ctrl+P\` to reach the shell.\n\n&nbsp;\n\nThe following list of default skipped commands is truncated when viewed in Settings Editor. To see the full list, [open the default settings JSON](command:workbench.action.openRawDefaultSettings 'Open Default Settings (JSON)') and search for the first command from the list below.\n\n&nbsp;\n\nDefault Skipped Commands:\n\n${[
                ...DEFAULT_COMMANDS_TO_SKIP_SHELL,
            ]
                .sort()
                .map((command) => `- ${command}`)
                .join("\n")}`,
        },
        // Our schema has no `restricted` and `tags: ['advanced']`.
        "terminal.integrated.enableKittyKeyboardProtocol": {
            scope: "window",
            type: "boolean",
            default: true,
            description:
                "Whether to enable the kitty keyboard protocol, which allows a program in the terminal to request more detailed keyboard input reporting. This can, for example, enable `Shift+Enter` to be handled by the program.",
        },
        "terminal.integrated.allowChords": {
            scope: "window",
            type: "boolean",
            default: true,
            description:
                "Whether or not to allow chord keybindings in the terminal. Note that when this is true and the keystroke results in a chord it will bypass `#terminal.integrated.commandsToSkipShell#`, setting this to false is particularly useful when you want ctrl+k to go to your shell (not VS Code).",
        },
        "terminal.integrated.allowMnemonics": {
            scope: "window",
            type: "boolean",
            default: false,
            description:
                "Whether to allow menubar mnemonics (for example Alt+F) to trigger the open of the menubar. Note that this will cause all alt keystrokes to skip the shell when true. This does nothing on macOS.",
        },
        // There is no remote here: "notRemote" behaves as "on".
        "terminal.integrated.enableFileLinks": {
            scope: "window",
            type: "string",
            default: "on",
            enum: ["off", "on", "notRemote"],
            enumDescriptions: ["Always off.", "Always on.", "Enable only when not in a remote workspace."],
            description:
                "Whether to enable file links in terminals. Links can be slow when working on a network drive in particular because each file link is verified against the file system. Changing this will take effect only in new terminals.",
        },
        // Ours: vscode has no host terminal, and its integrated one always takes colors from the theme (our "theme" default).
        "terminal.integrated.colorSource": {
            scope: "application",
            type: "string",
            default: "theme",
            enum: ["theme", "host"],
            enumDescriptions: [
                "Use the color theme: `terminal.ansi*` for the 16 ANSI colors, `terminal.background` and `terminal.foreground` for the default colors.",
                "Match the terminal Diode runs in: its 16 ANSI colors and default background and foreground, queried at startup (OSC 4/10/11). Colors the host terminal doesn't report come from the color theme.",
            ],
            description:
                "Controls where the integrated terminal takes its 16 ANSI colors and its default background and foreground from.",
        },
    },
} as const satisfies IConfigurationNode;
