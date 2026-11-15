import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

/**
 * Verbatim from upstream's `contrib/debug/browser/debug.contribution.ts` (no `scope` there: window;
 * `debug.openDebug` and `debug.internalConsoleOptions` have no `type` there either: a string). Only the keys the
 * ported code reads: the Debug Console (`replModel.ts`, opening and closing its view), the terminal of
 * `runInTerminal` (`debugTerminal.ts`), the Run and Debug views (opening them, types and lazy variables). The rest
 * of `debug.*` comes with the task that implements it (the toolbar, launch.json), the unsupported ones are declared
 * by the settings task (#1158).
 */
export const debugConfiguration = {
    id: "debug",
    title: "Debug",
    properties: {
        "debug.showVariableTypes": {
            scope: "window",
            type: "boolean",
            description: "Show variable type in variable pane during debug session",
            default: false,
        },
        "debug.openDebug": {
            scope: "window",
            type: "string",
            enum: ["neverOpen", "openOnSessionStart", "openOnFirstSessionStart", "openOnDebugBreak"],
            default: "openOnDebugBreak",
            description: "Controls when the debug view should open.",
        },
        "debug.internalConsoleOptions": {
            scope: "window",
            type: "string",
            enum: ["neverOpen", "openOnSessionStart", "openOnFirstSessionStart"],
            default: "openOnFirstSessionStart",
            description: "Controls when the internal Debug Console should open.",
        },
        "debug.console.closeOnEnd": {
            scope: "window",
            type: "boolean",
            description: "Controls if the Debug Console should be automatically closed when the debug session ends.",
            default: false,
        },
        "debug.console.collapseIdenticalLines": {
            scope: "window",
            type: "boolean",
            description:
                "Controls if the Debug Console should collapse identical lines and show a number of occurrences with a badge.",
            default: true,
        },
        "debug.console.maximumLines": {
            scope: "window",
            type: "number",
            description: "Controls the maximum number of lines in the Debug Console.",
            default: 10000,
        },
        "debug.terminal.clearBeforeReusing": {
            scope: "window",
            type: "boolean",
            description:
                "Before starting a new debug session in an integrated or external terminal, clear the terminal.",
            default: false,
        },
        "debug.autoExpandLazyVariables": {
            scope: "window",
            type: "string",
            enum: ["auto", "on", "off"],
            default: "auto",
            enumDescriptions: [
                "When in screen reader optimized mode, automatically expand lazy variables.",
                "Always automatically expand lazy variables.",
                "Never automatically expand lazy variables.",
            ],
            description:
                "Controls whether variables that are lazily resolved, such as getters, are automatically resolved and expanded by the debugger.",
        },
    },
} as const satisfies IConfigurationNode;
