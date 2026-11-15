import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

/**
 * Verbatim from upstream's `contrib/debug/browser/debug.contribution.ts` (no `scope` there: window). Only the keys
 * the ported code reads: the Debug Console model (`replModel.ts`), the terminal of `runInTerminal` (`debugTerminal.ts`). The rest of `debug.*` comes with the task that
 * implements it (the views, the toolbar, launch.json), the unsupported ones are declared by the settings task (#1158).
 */
export const debugConfiguration = {
    id: "debug",
    title: "Debug",
    properties: {
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
    },
} as const satisfies IConfigurationNode;
