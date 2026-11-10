import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    type IProgressNotificationOptions,
    MAX_VISIBLE_NOTIFICATIONS,
    NOTIFICATION_AUTO_HIDE_MS,
    NotificationService,
    PROGRESS_CANCEL_LABEL,
} from "./notificationService.ts";

function progress(patch: Partial<IProgressNotificationOptions> = {}) {
    const calls: string[] = [];
    const options: IProgressNotificationOptions = {
        message: "Indexing",
        cancellable: true,
        onCancel: () => calls.push("cancel"),
        onHide: () => calls.push("hide"),
        ...patch,
    };
    return { options, calls };
}

describe("NotificationService: progress notifications", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("an info toast with Cancel that never times out", () => {
        const service = new NotificationService();
        const { options } = progress();

        service.showProgress(options);
        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS.error * 10);

        expect(service.passive()).toEqual([
            expect.objectContaining({
                severity: "info",
                message: "Indexing",
                modal: false,
                items: [PROGRESS_CANCEL_LABEL],
                progress: {},
            }),
        ]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("without cancellable there is no button", () => {
        const service = new NotificationService();
        service.showProgress(progress({ cancellable: false }).options);

        expect(service.passive()[0].items).toEqual([]);
    });

    it("update replaces message and percent in place, under the same id", () => {
        const service = new NotificationService();
        const changes = vi.fn();
        service.onDidChange(changes);
        const handle = service.showProgress(progress().options);

        handle.update({ message: "Indexing: src", percent: 42 });

        expect(service.passive()).toEqual([
            expect.objectContaining({ id: handle.id, message: "Indexing: src", progress: { percent: 42 } }),
        ]);
        expect(service.passive()[0].items).toEqual([PROGRESS_CANCEL_LABEL]);
        expect(changes).toHaveBeenCalledTimes(2);
    });

    it("takes one of the visible slots", () => {
        const service = new NotificationService();
        service.showProgress(progress().options);
        for (let i = 0; i < MAX_VISIBLE_NOTIFICATIONS; i++) {
            service.show({ severity: "info", message: `m${String(i)}`, modal: false, items: [] });
        }

        expect(service.passive()).toHaveLength(MAX_VISIBLE_NOTIFICATIONS);
        expect(service.queuedPassiveCount()).toBe(1);
    });

    it("an identical passive message does not replace a progress with the same text", () => {
        const service = new NotificationService();
        service.showProgress(progress({ message: "same" }).options);

        service.show({ severity: "info", message: "same", modal: false, items: [] });

        expect(service.passive()).toHaveLength(2);
    });

    it("Cancel (answer 0) removes it and calls onCancel, not onHide", () => {
        const service = new NotificationService();
        const { options, calls } = progress();
        const handle = service.showProgress(options);

        service.answer(handle.id, 0);
        service.answer(handle.id, 0);

        expect(service.passive()).toEqual([]);
        expect(calls).toEqual(["cancel"]);
    });

    it("an answer outside Cancel, or to a non-cancellable progress, changes nothing", () => {
        const service = new NotificationService();
        const cancellable = progress();
        const plain = progress({ cancellable: false });
        const a = service.showProgress(cancellable.options);
        const b = service.showProgress(plain.options);

        service.answer(a.id, 1);
        service.answer(a.id, -1);
        service.answer(b.id, 0);
        service.answer(999, 0);

        expect(service.passive()).toHaveLength(2);
        expect([...cancellable.calls, ...plain.calls]).toEqual([]);
    });

    it("dismiss (Escape) hides it: onHide, not onCancel", () => {
        const service = new NotificationService();
        const { options, calls } = progress();
        const handle = service.showProgress(options);

        service.dismiss(handle.id);

        expect(service.passive()).toEqual([]);
        expect(calls).toEqual(["hide"]);
    });

    it("Clear All hides a running progress after the list is empty", () => {
        const service = new NotificationService();
        let seenAtHide: number | undefined;
        const { options, calls } = progress({
            onHide: () => {
                seenAtHide = service.passive().length;
                calls.push("hide");
            },
        });
        service.showProgress(options);
        service.show({ severity: "info", message: "x", modal: false, items: [] });

        service.clearAll();

        expect(calls).toEqual(["hide"]);
        expect(seenAtHide).toBe(0);
    });

    it("close removes it silently; later calls on the handle are no-ops", () => {
        const service = new NotificationService();
        const changes = vi.fn();
        const { options, calls } = progress();
        const handle = service.showProgress(options);
        service.onDidChange(changes);

        handle.close();
        handle.close();
        handle.update({ message: "late", percent: 10 });

        expect(service.passive()).toEqual([]);
        expect(calls).toEqual([]);
        expect(changes).toHaveBeenCalledTimes(1);
    });

    it("a removed progress frees its slot: the queued toast gets its timer", () => {
        const service = new NotificationService();
        for (let i = 0; i < MAX_VISIBLE_NOTIFICATIONS; i++) service.showProgress(progress().options);
        service.show({ severity: "info", message: "queued", modal: false, items: [] });
        const first = service.passive()[0].id;
        expect(vi.getTimerCount()).toBe(0);

        service.dismiss(first);

        expect(service.passive().map((n) => n.message)).toContain("queued");
        expect(vi.getTimerCount()).toBe(1);
    });
});
