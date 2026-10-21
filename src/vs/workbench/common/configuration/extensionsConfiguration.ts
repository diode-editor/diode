import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

/** Дословно `extensions.contribution.ts` эталона; `items: string` наша схема не выражает. */
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
