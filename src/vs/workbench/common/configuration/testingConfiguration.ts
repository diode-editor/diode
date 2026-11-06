import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

/**
 * Verbatim from upstream's `contrib/testing/common/configuration.ts` (no `scope` there: window); `markdownDescription`
 * goes into `description`. Keys of the features not ported yet (peek, gutter, coverage, results view) are not
 * registered.
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
