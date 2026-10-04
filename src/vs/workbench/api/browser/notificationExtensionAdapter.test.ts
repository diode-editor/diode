import { describe, expect, it } from "vitest";

import { NotificationService } from "../../services/notification/browser/notificationService.ts";
import type { INotificationRequest } from "../common/iExtensionWindowSinks.ts";

import { findCloseAffordance, NotificationExtensionAdapter } from "./notificationExtensionAdapter.ts";

function request(patch: Partial<INotificationRequest> = {}): INotificationRequest {
    return { handle: 1, severity: "info", message: "hello", modal: false, items: [], ...patch };
}

describe("findCloseAffordance", () => {
    it("первая помеченная кнопка", () => {
        expect(
            findCloseAffordance([
                { title: "Delete", isCloseAffordance: false },
                { title: "Cancel", isCloseAffordance: true },
                { title: "Later", isCloseAffordance: true },
            ]),
        ).toBe(1);
    });

    it("помеченная ПЕРВОЙ — это индекс 0, а не «не найдено»", () => {
        expect(
            findCloseAffordance([
                { title: "Cancel", isCloseAffordance: true },
                { title: "Delete", isCloseAffordance: false },
            ]),
        ).toBe(0);
    });

    it("ни одной помеченной — undefined", () => {
        expect(findCloseAffordance([{ title: "Ok", isCloseAffordance: false }])).toBeUndefined();
        expect(findCloseAffordance([])).toBeUndefined();
    });
});

describe("NotificationExtensionAdapter", () => {
    it("сообщение без кнопок доходит до сервиса и резолвится сразу", async () => {
        const notifications = new NotificationService();
        const adapter = new NotificationExtensionAdapter(notifications);

        const answer = await adapter.showMessage(request({ severity: "error", message: "boom" }));

        expect(answer).toBeUndefined();
        expect(notifications.passive().map((n) => n.message)).toEqual(["boom"]);
    });

    it("кнопки едут заголовками, ответ — индексом", async () => {
        const notifications = new NotificationService();
        const adapter = new NotificationExtensionAdapter(notifications);

        const pending = adapter.showMessage(
            request({
                items: [
                    { title: "Activate", isCloseAffordance: false },
                    { title: "Free", isCloseAffordance: false },
                ],
            }),
        );
        const current = notifications.current();
        expect(current?.items).toEqual(["Activate", "Free"]);

        notifications.answer(current?.id ?? -1, 1);
        await expect(pending).resolves.toBe(1);
    });

    it("detail и modal доезжают до сервиса", () => {
        const notifications = new NotificationService();
        const adapter = new NotificationExtensionAdapter(notifications);

        void adapter.showMessage(request({ modal: true, detail: "нельзя отменить" }));

        expect(notifications.current()).toMatchObject({ modal: true, detail: "нельзя отменить" });
    });

    it("isCloseAffordance превращается в индекс закрывающей кнопки", () => {
        const notifications = new NotificationService();
        const adapter = new NotificationExtensionAdapter(notifications);

        void adapter.showMessage(
            request({
                modal: true,
                items: [
                    { title: "Delete", isCloseAffordance: false },
                    { title: "Cancel", isCloseAffordance: true },
                ],
            }),
        );

        expect(notifications.current()?.closeAffordance).toBe(1);
    });

    it("без помеченной кнопки closeAffordance не выставляется", () => {
        const notifications = new NotificationService();
        const adapter = new NotificationExtensionAdapter(notifications);

        void adapter.showMessage(request({ modal: true, items: [{ title: "Ok", isCloseAffordance: false }] }));

        expect(notifications.current()?.closeAffordance).toBeUndefined();
    });

    it("cancel(handle) снимает показ ЭТОГО расширения и доводит обещание до undefined", async () => {
        const notifications = new NotificationService();
        const adapter = new NotificationExtensionAdapter(notifications);

        const pending = adapter.showMessage(
            request({ handle: 42, items: [{ title: "One", isCloseAffordance: false }] }),
        );
        adapter.cancel(42);

        await expect(pending).resolves.toBeUndefined();
        expect(notifications.current()).toBeNull();
    });

    it("cancel по чужому handle ничего не гасит", () => {
        const notifications = new NotificationService();
        const adapter = new NotificationExtensionAdapter(notifications);

        void adapter.showMessage(request({ handle: 42, items: [{ title: "One", isCloseAffordance: false }] }));
        adapter.cancel(7);

        expect(notifications.current()?.items).toEqual(["One"]);
    });

    it("cancel после ответа — no-op: handle уже забыт", async () => {
        const notifications = new NotificationService();
        const adapter = new NotificationExtensionAdapter(notifications);

        const pending = adapter.showMessage(
            request({ handle: 42, items: [{ title: "One", isCloseAffordance: false }] }),
        );
        const id = notifications.current()?.id ?? -1;
        notifications.answer(id, 0);
        await expect(pending).resolves.toBe(0);

        const other = notifications.show({ severity: "info", message: "чужое", modal: false, items: ["X"] });
        adapter.cancel(42);
        expect(notifications.current()?.id).toBe(other.id);
    });
});
