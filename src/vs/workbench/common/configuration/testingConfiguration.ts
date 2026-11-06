import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

/**
 * Verbatim from upstream's `contrib/testing/common/configuration.ts` (no `scope` there: window); `markdownDescription`
 * goes into `description`. Keys of the features not ported yet (peek, gutter, coverage) are not registered.
 * Upstream's migrations of `testing.openTesting` and `testing.automaticallyOpenResults` into
 * `testing.automaticallyOpenTestResults` are not ported: there is no settings migration here.
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
        "testing.automaticallyOpenTestResults": {
            scope: "window",
            type: "string",
            enum: ["neverOpen", "openOnTestStart", "openOnTestFailure", "openExplorerOnTestStart"],
            enumDescriptions: [
                "Never automatically open the testing views",
                "Open the test results view when tests start",
                "Open the test result view on any test failure",
                "Open the test explorer when tests start",
            ],
            default: "openOnTestStart",
            description: "Controls when the testing view should open.",
        },
        "testing.resultsView.layout": {
            scope: "window",
            type: "string",
            enum: ["treeRight", "treeLeft"],
            enumDescriptions: [
                "Show the test run tree on the right side with details on the left.",
                "Show the test run tree on the left side with details on the right.",
            ],
            default: "treeRight",
            description: "Controls the layout of the Test Results view.",
        },
    },
} as const satisfies IConfigurationNode;
