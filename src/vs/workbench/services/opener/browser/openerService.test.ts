import { describe, expect, it, vi } from "vitest";

import { InMemoryClipboard } from "../../../../platform/clipboard/common/inMemoryClipboard.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { IExternalOpener } from "../../../../platform/opener/common/iExternalOpener.ts";
import { NotificationService } from "../../notification/browser/notificationService.ts";

import { COPY_LINK_ITEM, OpenerService } from "./openerService.ts";

/** Конфиг без автоскрытия: тост-запасной-путь не должен гаснуть из-под теста. */
const NO_AUTO_HIDE = {
    get: () => 0,
    getValue: () => undefined,
    inspect: () => ({ key: "", value: undefined }),
    onDidChangeConfiguration: () => ({ dispose: () => undefined }),
} as unknown as IConfigurationService;

/**
 * Прокручивает микротаски: сообщение появляется ПОСЛЕ отказа системного
 * открывателя, а он асинхронный — синхронно стек ещё пуст.
 */
async function tick(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function make(systemOpens: boolean) {
    const systemOpener: IExternalOpener = { openExternal: vi.fn().mockResolvedValue(systemOpens) };
    const notificationService = new NotificationService(NO_AUTO_HIDE);
    const clipboard = new InMemoryClipboard();
    return {
        systemOpener,
        notificationService,
        clipboard,
        service: new OpenerService(systemOpener, notificationService, clipboard),
    };
}

describe("OpenerService", () => {
    it("системный открыватель справился — сообщение не показываем", async () => {
        const { service, systemOpener, notificationService } = make(true);
        await expect(service.openExternal("https://example.com/auth")).resolves.toBe(true);
        expect(systemOpener.openExternal).toHaveBeenCalledWith("https://example.com/auth");
        expect(notificationService.notifications()).toEqual([]);
    });

    it("открывать некому — ссылка едет человеку тостом, и адрес виден в тексте", async () => {
        const { service, notificationService } = make(false);
        const opened = service.openExternal("https://example.com/auth");
        await tick();
        const shown = notificationService.notifications().at(0);
        expect(shown?.message).toContain("https://example.com/auth");
        expect(shown?.items).toEqual([COPY_LINK_ITEM]);
        // Ответ всё равно «успех»: ссылка у человека — это и есть то, чего
        // добивалось расширение.
        notificationService.dismiss(shown!.id);
        await expect(opened).resolves.toBe(true);
    });

    it("нажатие «Copy Link» кладёт адрес в буфер обмена приложения", async () => {
        const { service, notificationService, clipboard } = make(false);
        const opened = service.openExternal("https://example.com/auth");
        await tick();
        notificationService.accept(notificationService.notifications().at(0)!.id, 0);
        await expect(opened).resolves.toBe(true);
        await expect(clipboard.readText()).resolves.toBe("https://example.com/auth");
    });

    it("закрытие без нажатия буфер не трогает", async () => {
        const { service, notificationService, clipboard } = make(false);
        const opened = service.openExternal("https://example.com/auth");
        await tick();
        notificationService.dismiss(notificationService.notifications().at(0)!.id);
        await expect(opened).resolves.toBe(true);
        await expect(clipboard.readText()).resolves.toBe("");
    });
});
