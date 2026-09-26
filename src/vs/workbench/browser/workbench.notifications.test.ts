import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { InMemoryClipboard } from "../../platform/clipboard/common/inMemoryClipboard.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { ClipboardDIToken } from "../common/coreTokens.ts";
import type { NotificationService } from "../services/notification/browser/notificationService.ts";
import { NotificationServiceDIToken } from "../services/notification/browser/notificationService.ts";
import type { OpenerService } from "../services/opener/browser/openerService.ts";
import { OpenerServiceDIToken } from "../services/opener/browser/openerService.ts";

import { NotificationsToastsComponentDIToken } from "./parts/notifications/notificationsToastsComponent.ts";
import { WorkbenchContextKeysDIToken } from "./workbenchContextKeys.ts";

// Сообщение доходит до КАДРА настоящего приложения, а не до стока: сток и
// компонент проверены по отдельности, а здесь — что они связаны (модуль
// биндит сервисы, WorkbenchComponent прикрепляет оверлей, контекст-ключ едет в
// ContextKeyService) и что тост реально рисуется в правом нижнем углу.

describe("Workbench — тосты сообщений", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let notifications: NotificationService;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-notifications-", files: { "a.ts": "// a" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 24) });
        h.workbench.openFile(ws.path("a.ts"));
        h.workbench.focusEditor();
        h.testApp.render();
        notifications = h.container.get(NotificationServiceDIToken);
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("сообщение появляется на кадре: заголовок строгости, текст, кнопка", () => {
        void notifications.notify({ severity: "error", message: "Language server crashed", items: ["Retry"] });
        h.testApp.render();
        const frame = h.testApp.backend.screenToString();
        expect(frame).toContain("Error");
        expect(frame).toContain("Language server crashed");
        expect(frame).toContain("Retry");
    });

    it("тост прижат к правому нижнему углу", () => {
        void notifications.notify({ severity: "info", message: "fyi" });
        h.testApp.render();
        const lines = h.testApp.backend.screenToString().split("\n");
        const row = lines.findIndex((line) => line.includes("fyi"));
        // Нижняя половина экрана (над статус-баром), а не поверх первых строк файла.
        expect(row).toBeGreaterThan(lines.length / 2);
        // Правая рамка стоит в предпоследней колонке: отступ от края — ровно один.
        expect(lines[row].trimEnd().length).toBe(79);
    });

    it("`notificationToastsVisible` живёт по видимости стека", () => {
        const contextKeys = h.container.get(ContextKeyServiceDIToken);
        const workbenchContextKeys = h.container.get(WorkbenchContextKeysDIToken);
        workbenchContextKeys.update();
        expect(contextKeys.get("notificationToastsVisible")).toBe(false);

        void notifications.notify({ severity: "info", message: "fyi", items: ["OK"] });
        h.testApp.render();
        workbenchContextKeys.update();
        expect(contextKeys.get("notificationToastsVisible")).toBe(true);

        notifications.clearAll();
        h.testApp.render();
        workbenchContextKeys.update();
        expect(contextKeys.get("notificationToastsVisible")).toBe(false);
    });

    it("команда фокуса доводит фокус до кнопки, Enter отвечает расширению", async () => {
        const answer = notifications.notify({ severity: "info", message: "fyi", items: ["Activate", "Free"] });
        h.testApp.render();

        await h.commands.execute("notifications.focusToasts");
        h.testApp.render();
        h.testApp.sendKey("ArrowRight");
        h.testApp.sendKey("Enter");

        await expect(answer).resolves.toBe(1);
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).not.toContain("Activate");
    });

    it("команда «закрыть все» снимает стек и дорешивает обещания", async () => {
        const answer = notifications.notify({ severity: "error", message: "boom", items: ["Retry"] });
        h.testApp.render();
        await h.commands.execute("notifications.clearAll");
        await expect(answer).resolves.toBeUndefined();
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).not.toContain("boom");
    });

    it("открыватель ссылок связан с сообщениями и буфером обмена приложения", async () => {
        // В тестовом профиле системного открывателя нет — значит идёт запасной
        // путь: ссылка человеку тостом, «Copy Link» кладёт её в буфер редактора.
        const opener: OpenerService = h.container.get(OpenerServiceDIToken);
        const opened = opener.openExternal("https://example.com/activate?token=demo");
        await Promise.resolve();
        await Promise.resolve();
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("Copy Link");

        await h.commands.execute("notifications.focusToasts");
        h.testApp.sendKey("Enter");
        await expect(opened).resolves.toBe(true);

        const clipboard = h.container.get(ClipboardDIToken);
        expect(clipboard).toBeInstanceOf(InMemoryClipboard);
        await expect(clipboard.readText()).resolves.toBe("https://example.com/activate?token=demo");
    });

    it("оверлей тостов не забирает фокус у редактора", () => {
        void notifications.notify({ severity: "info", message: "fyi", items: ["OK"] });
        h.testApp.render();
        // Набранное после появления тоста попадает В РЕДАКТОР, а не в оверлей.
        h.testApp.sendKey("x");
        expect(h.activeEditor().getText()).toContain("x");
        expect(h.container.get(NotificationsToastsComponentDIToken).isOpen()).toBe(true);
    });
});
