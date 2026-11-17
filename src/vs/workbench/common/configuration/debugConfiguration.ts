import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

/**
 * Verbatim from upstream's `contrib/debug/browser/debug.contribution.ts` (no `scope` there: window; `debug.openDebug`
 * and `debug.internalConsoleOptions` have no `type` there either: a string). Only the keys the ported code reads: the
 * Debug Console (`replModel.ts`, opening and closing its view), the terminal of `runInTerminal` (`debugTerminal.ts`), launch.json and the debug tasks
 * (`debugConfigurationManager.ts`, `debugTaskRunner.ts`, `debugService.ts`), the Run and Debug views (opening them,
 * types, lazy variables and the breakpoints presentation), the debug toolbar and the status bar (`debugToolbar.ts`,
 * `statusbarColorProvider.ts`, `debugStatus.ts`). The rest of `debug.*` comes with the task that implements it, the
 * unsupported ones are declared by the settings task (#1158). `launch` has no JSON schema of its configurations yet
 * (IntelliSense in launch.json is a task of its own).
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
        "debug.breakpointsView.presentation": {
            scope: "window",
            type: "string",
            description:
                "Controls whether breakpoints are displayed in a tree view grouped by file, or as a flat list.",
            enum: ["tree", "list"],
            default: "list",
        },
        "debug.toolBarLocation": {
            scope: "window",
            type: "string",
            enum: ["floating", "docked", "commandCenter", "hidden"],
            description:
                "Controls the location of the debug toolbar. Either `floating` in all views, `docked` in the debug view, `commandCenter` (requires `#window.commandCenter#`), or `hidden`.",
            default: "floating",
            enumDescriptions: [
                "Show debug toolbar in all views.",
                "Show debug toolbar only in debug views.",
                "`(Experimental)` Show debug toolbar in the command center.",
                "Do not show debug toolbar.",
            ],
        },
        "debug.showInStatusBar": {
            scope: "window",
            type: "string",
            enum: ["never", "always", "onFirstSessionStart"],
            enumDescriptions: [
                "Never show debug item in status bar",
                "Always show debug item in status bar",
                "Show debug item in status bar only after debug was started for the first time",
            ],
            description: "Controls when the debug status bar item should be visible.",
            default: "onFirstSessionStart",
        },
        "debug.showSubSessionsInToolBar": {
            scope: "window",
            type: "boolean",
            description:
                "Controls whether the debug sub-sessions are shown in the debug tool bar. When this setting is false the stop command on a sub-session will also stop the parent session.",
            default: false,
        },
        "debug.enableStatusBarColor": {
            scope: "window",
            type: "boolean",
            description: "Color of the status bar when the debugger is active.",
            default: true,
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
        launch: {
            scope: "window",
            type: "object",
            description:
                "Global debug launch configuration. Should be used as an alternative to 'launch.json' that is shared across workspaces.",
            default: { configurations: [], compounds: [] },
        },
        "debug.onTaskErrors": {
            scope: "window",
            type: "string",
            enum: ["debugAnyway", "showErrors", "prompt", "abort"],
            enumDescriptions: [
                "Ignore task errors and start debugging.",
                "Show the Problems view and do not start debugging.",
                "Prompt user.",
                "Cancel debugging.",
            ],
            description: "Controls what to do when errors are encountered after running a preLaunchTask.",
            default: "prompt",
        },
        "debug.saveBeforeStart": {
            scope: "language-overridable",
            type: "string",
            description: "Controls what editors to save before starting a debug session.",
            enum: ["allEditorsInActiveGroup", "nonUntitledEditorsInActiveGroup", "none"],
            enumDescriptions: [
                "Save all editors in the active group before starting a debug session.",
                "Save all editors in the active group except untitled ones before starting a debug session.",
                "Don't save any editors before starting a debug session.",
            ],
            default: "allEditorsInActiveGroup",
        },
        "debug.confirmOnExit": {
            scope: "window",
            type: "string",
            description: "Controls whether to confirm when the window closes if there are active debug sessions.",
            enum: ["never", "always"],
            enumDescriptions: ["Never confirm.", "Always confirm if there are debug sessions."],
            default: "never",
        },
        "debug.hideSlowPreLaunchWarning": {
            scope: "window",
            type: "boolean",
            description: "Hide the warning shown when a `preLaunchTask` has been running for a while.",
            default: false,
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
