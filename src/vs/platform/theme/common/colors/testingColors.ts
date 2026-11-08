import type { ColorContribution } from "../colorRegistry.ts";

/**
 * Upstream `contrib/testing/browser/theme.ts`: the state icons of the Test Explorer and the messages shown inline in
 * the editor. Upstream's `testing.iconQueued` refers to `list.warningForeground`, which this registry does not have:
 * its values are baked in, as `transparent(editorForeground, 0.5)` of `testing.message.info.decorationForeground`.
 * The badge's border and the lines' margin colors are registered as the contract: a cell has no border, the margin
 * is not painted.
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
    "testing.message.error.badgeBackground": {
        defaults: { dark: "activityErrorBadge.background", light: "activityErrorBadge.background" },
        description: "Background color of test error messages shown inline in the editor.",
    },
    "testing.message.error.badgeBorder": {
        defaults: { dark: "testing.message.error.badgeBackground", light: "testing.message.error.badgeBackground" },
        description: "Border color of test error messages shown inline in the editor.",
    },
    "testing.message.error.badgeForeground": {
        defaults: { dark: "activityErrorBadge.foreground", light: "activityErrorBadge.foreground" },
        description: "Text color of test error messages shown inline in the editor.",
    },
    "testing.message.error.lineBackground": {
        defaults: null,
        description: "Margin color beside error messages shown inline in the editor.",
    },
    "testing.message.info.decorationForeground": {
        defaults: { dark: "#D4D4D480", light: "#3B3B3B80" },
        description: "Text color of test info messages shown inline in the editor.",
    },
    "testing.message.info.lineBackground": {
        defaults: null,
        description: "Margin color beside info messages shown inline in the editor.",
    },
} as const satisfies ColorContribution;
