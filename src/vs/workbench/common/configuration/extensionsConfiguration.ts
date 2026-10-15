import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

/**
 * Настройки расширений (`extensions.*`) — ключ, дефолт, scope и описание
 * дословно из `extensions.contribution.ts` эталона. Пока один ключ — доверие
 * обработчикам URI (`ExtensionUrlHandler`); остальные ключи эталона без
 * функции не зарегистрированы. `items: string` эталона наша схема не выражает.
 */
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
