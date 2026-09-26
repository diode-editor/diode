import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

export const notificationsConfiguration: IConfigurationNode = {
    id: "notifications",
    title: "Notifications",
    properties: {
        // Своя настройка (в VS Code это захардкоженные 15 секунд). Нужна двум
        // потребителям: человеку в узком терминале, которому тост мешает, и
        // сценариям-демо, которым нужен детерминированный экран.
        "notifications.autoHideTimeout": {
            type: "number",
            default: 15000,
            description:
                "How long an informational notification without buttons stays on screen, in milliseconds. 0 keeps it until dismissed. Warnings, errors and notifications with buttons never hide by themselves.",
        },
    },
};
