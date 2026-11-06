import type { ColorContribution } from "../colorRegistry.ts";

/**
 * Upstream `contrib/testing/browser/theme.ts`: the state icons of the Test Explorer. Upstream's `testing.iconQueued`
 * refers to `list.warningForeground`, which this registry does not have: its values are baked in.
 */
export const testingColors = {
    "testing.iconFailed": {
        defaults: { dark: "list.errorForeground", light: "list.errorForeground" },
        description: "Color for the 'failed' icon in the test explorer.",
    },
    "testing.iconErrored": {
        defaults: { dark: "list.errorForeground", light: "list.errorForeground" },
        description: "Color for the 'Errored' icon in the test explorer.",
    },
    "testing.iconPassed": {
        defaults: { dark: "#73C991", light: "#73C991" },
        description: "Color for the 'passed' icon in the test explorer.",
    },
    "testing.runAction": {
        defaults: { dark: "testing.iconPassed", light: "testing.iconPassed" },
        description: "Color for 'run' icons in the editor.",
    },
    "testing.iconQueued": {
        defaults: { dark: "#CCA700", light: "#855F00" },
        description: "Color for the 'Queued' icon in the test explorer.",
    },
    "testing.iconUnset": {
        defaults: { dark: "#848484", light: "#848484" },
        description: "Color for the 'Unset' icon in the test explorer.",
    },
    "testing.iconSkipped": {
        defaults: { dark: "#848484", light: "#848484" },
        description: "Color for the 'Skipped' icon in the test explorer.",
    },
} as const satisfies ColorContribution;
