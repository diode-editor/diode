import { describe, expect, it } from "vitest";

import { NotificationService } from "../../services/notification/browser/notificationService.ts";
import type { INotificationRequest } from "../common/iExtensionWindowSinks.ts";

import { findCloseAffordance, NotificationExtensionAdapter } from "./notificationExtensionAdapter.ts";

function request(patch: Partial<INotificationRequest> = {}): INotificationRequest {
    return { handle: 1, severity: "info", message: "hello", modal: false, items: [], ...patch };
}

describe("findCloseAffordance", () => {
    it("first flagged button", () => {
        expect(
            findCloseAffordance([
                { title: "Delete", isCloseAffordance: false },
                { title: "Cancel", isCloseAffordance: true },
                { title: "Later", isCloseAffordance: true },
            ]),
        ).toBe(1);
    });

    it("flagged FIRST is index 0, not 'not found'", () => {
        expect(
            findCloseAffordance([
                { title: "Cancel", isCloseAffordance: true },
                { title: "Delete", isCloseAffordance: false },
            ]),
        ).toBe(0);
    });

    it("none flagged yields undefined", () => {
        expect(findCloseAffordance([{ title: "Ok", isCloseAffordance: false }])).toBeUndefined();
        expect(findCloseAffordance([])).toBeUndefined();
    });
});

describe("NotificationExtensionAdapter", () => {
    it("message without buttons reaches the service and resolves immediately", async () => {
        const notifications = new NotificationService();
        const adapter = new NotificationExtensionAdapter(notifications);

        const answer = await adapter.showMessage(request({ severity: "error", message: "boom" }));

        expect(answer).toBeUndefined();
        expect(notifications.passive().map((n) => n.message)).toEqual(["boom"]);
    });

    it("buttons are sent as titles, the answer as an index", async () => {
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

    it("detail and modal reach the service", () => {
        const notifications = new NotificationService();
        const adapter = new NotificationExtensionAdapter(notifications);

        void adapter.showMessage(request({ modal: true, detail: "cannot be undone" }));

        expect(notifications.current()).toMatchObject({ modal: true, detail: "cannot be undone" });
    });

    it("isCloseAffordance becomes the close button index", () => {
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

    it("without a flagged button closeAffordance is not set", () => {
        const notifications = new NotificationService();
        const adapter = new NotificationExtensionAdapter(notifications);

        void adapter.showMessage(request({ modal: true, items: [{ title: "Ok", isCloseAffordance: false }] }));

        expect(notifications.current()?.closeAffordance).toBeUndefined();
    });

    it("cancel(handle) dismisses THIS extension's message and resolves the promise to undefined", async () => {
        const notifications = new NotificationService();
        const adapter = new NotificationExtensionAdapter(notifications);

        const pending = adapter.showMessage(
            request({ handle: 42, items: [{ title: "One", isCloseAffordance: false }] }),
        );
        adapter.cancel(42);

        await expect(pending).resolves.toBeUndefined();
        expect(notifications.current()).toBeNull();
    });

    it("cancel with a foreign handle dismisses nothing", () => {
        const notifications = new NotificationService();
        const adapter = new NotificationExtensionAdapter(notifications);

        void adapter.showMessage(request({ handle: 42, items: [{ title: "One", isCloseAffordance: false }] }));
        adapter.cancel(7);

        expect(notifications.current()?.items).toEqual(["One"]);
    });

    it("cancel after the answer is a no-op: the handle is already forgotten", async () => {
        const notifications = new NotificationService();
        const adapter = new NotificationExtensionAdapter(notifications);

        const pending = adapter.showMessage(
            request({ handle: 42, items: [{ title: "One", isCloseAffordance: false }] }),
        );
        const id = notifications.current()?.id ?? -1;
        notifications.answer(id, 0);
        await expect(pending).resolves.toBe(0);

        const other = notifications.show({ severity: "info", message: "foreign", modal: false, items: ["X"] });
        adapter.cancel(42);
        expect(notifications.current()?.id).toBe(other.id);
    });
});
