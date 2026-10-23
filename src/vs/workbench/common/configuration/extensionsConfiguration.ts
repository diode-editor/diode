import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

/**
 * Verbatim from upstream's `extensions.contribution.ts`; our schema can't express `items: string`. Ours: the
 * updates come from the diode registry, not "a Microsoft online service"; `extensions.autoUpdate` also lists the
 * older `true`/`false` (upstream reads them as `on`/`off` and its schema does not reject them, ours would).
 */
export const extensionsConfiguration = {
    id: "extensions",
    title: "Extensions",
    properties: {
        "extensions.autoUpdate": {
            type: ["string", "boolean"],
            enum: ["on", "off", true, false],
            enumDescriptions: [
                "Download and install updates automatically only for enabled extensions.",
                "Extensions are not automatically updated.",
                "Same as `on`.",
                "Same as `off`.",
            ],
            description:
                "Controls the automatic update behavior of extensions. The updates are fetched from the extension registry.",
            default: "on",
            scope: "application",
        },
        "extensions.autoUpdateDelay": {
            type: "number",
            default: 2,
            minimum: 0,
            description:
                "Controls the delay in hours after an extension update is published before it is automatically installed. Only applies when `#extensions.autoUpdate#` is set to `on`. This delay helps avoid installing potentially problematic updates immediately after release.",
            scope: "application",
        },
        "extensions.autoCheckUpdates": {
            type: "boolean",
            description:
                "When enabled, automatically checks extensions for updates. If an extension has an update, it is marked as outdated in the Extensions view. The updates are fetched from the extension registry.",
            default: true,
            scope: "application",
        },
        "extensions.confirmedUriHandlerExtensionIds": {
            scope: "application",
            type: "array",
            default: [],
            description:
                "When an extension is listed here, a confirmation prompt will not be shown when that extension handles a URI.",
        },
    },
} as const satisfies IConfigurationNode;
