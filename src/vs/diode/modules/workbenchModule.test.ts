import { describe, expect, it } from "vitest";

import { ClipboardDIToken } from "../../workbench/common/coreTokens.ts";
import { ExternalOpenerDIToken } from "../../workbench/services/externalOpener/common/iExternalOpener.ts";
import { NotificationServiceDIToken } from "../../workbench/services/notification/browser/notificationService.ts";

import { createTestContainer } from "./testProfile.ts";

/**
 * Проводка открывателя внешних ссылок в DI. Проверяем не «биндинг объявлен», а
 * что через него доезжают НАСТОЯЩИЕ швы: без графического сеанса ссылка обязана
 * оказаться и в буфере обмена приложения, и сообщением на экране. Перепутанный
 * шов даёт рабочий контейнер и молчащий редактор — ровно тот случай, из-за
 * которого расширение «ведёт в никуда».
 */
describe("workbenchModule — env.openExternal", () => {
    it("без графического сеанса кладёт ссылку в буфер приложения и показывает сообщение", async () => {
        const { container } = createTestContainer();
        const noDisplay = { ...process.env };
        delete noDisplay.DISPLAY;
        delete noDisplay.WAYLAND_DISPLAY;
        const restore = process.env;
        try {
            // Окружение читается в момент создания сервиса — правим его вокруг резолва.
            process.env = noDisplay as NodeJS.ProcessEnv;
            const opener = container.get(ExternalOpenerDIToken);
            const notifications = container.get(NotificationServiceDIToken);

            await expect(opener.open("https://example.com/activate?token=42")).resolves.toBe(true);

            expect(await container.get(ClipboardDIToken).readText()).toBe("https://example.com/activate?token=42");
            expect(notifications.passive().map((n) => n.message)).toEqual([
                "Ссылка скопирована в буфер обмена: https://example.com/activate?token=42",
            ]);
        } finally {
            process.env = restore;
        }
    });

    it("чужую схему не берётся открывать вовсе", async () => {
        const { container } = createTestContainer();
        const opener = container.get(ExternalOpenerDIToken);

        await expect(opener.open("file:///etc/passwd")).resolves.toBe(false);
        expect(container.get(NotificationServiceDIToken).passive()).toEqual([]);
    });
});
