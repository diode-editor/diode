import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

/**
 * Verbatim from upstream's `contrib/testing/common/configuration.ts` (no `scope` there: window); `markdownDescription`
 * goes into `description`. Keys of the features not ported yet (peek, coverage, results view) are not registered.
 * `testing.defaultGutterClickAction`'s `debug` and `runWithCoverage` are registered as the contract, and run the test:
 * there is no debugger and no coverage yet.
 */
export const testingConfiguration = {
    id: "testing",
    title: "Testing",
    properties: {
        "testing.followRunningTest": {
            scope: "window",
            type: "boolean",
            default: false,
            description: "Controls whether the running test should be followed in the Test Explorer view.",
        },
        "testing.defaultGutterClickAction": {
            scope: "window",
            type: "string",
            description: "Controls the action to take when left-clicking on a test decoration in the gutter.",
            enum: ["run", "debug", "runWithCoverage", "contextMenu"],
            enumDescriptions: [
                "Run the test.",
                "Debug the test.",
                "Run the test with coverage.",
                "Open the context menu for more options.",
            ],
            default: "run",
        },
        "testing.gutterEnabled": {
            scope: "window",
            type: "boolean",
            default: true,
            description: "Controls whether test decorations are shown in the editor gutter.",
        },
        "testing.saveBeforeTest": {
            scope: "window",
            type: "boolean",
            default: true,
            description: "Control whether save all dirty editors before running a test.",
        },
        "testing.alwaysRevealTestOnStateChange": {
            scope: "window",
            type: "boolean",
            default: false,
            description:
                "Always reveal the executed test when `#testing.followRunningTest#` is on. If this setting is turned off, only failed tests will be revealed.",
        },
    },
} as const satisfies IConfigurationNode;
