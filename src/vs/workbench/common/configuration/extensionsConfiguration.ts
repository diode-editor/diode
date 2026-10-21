import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

/** Verbatim from upstream's `extensions.contribution.ts`; our schema can't express `items: string`. */
export const extensionsConfiguration = {
    id: "extensions",
    title: "Extensions",
    properties: {
        "extensions.confirmedUriHandlerExtensionIds": {
            scope: "application",
            type: "array",
            default: [],
            description:
                "When an extension is listed here, a confirmation prompt will not be shown when that extension handles a URI.",
        },
    },
} as const satisfies IConfigurationNode;
