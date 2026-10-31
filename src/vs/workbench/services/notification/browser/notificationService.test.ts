import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    type INotificationMessage,
    MAX_VISIBLE_NOTIFICATIONS,
    NOTIFICATION_ASK_TIMEOUT_MS,
    NOTIFICATION_AUTO_HIDE_MS,
    NotificationService,
} from "./notificationService.ts";

function message(patch: Partial<INotificationMessage> = {}): INotificationMessage {
    return { severity: "info", message: "hello", modal: false, items: [], ...patch };
}

describe("NotificationService: messages without buttons", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("resolves IMMEDIATELY and stays visible: waiting for close would hang the extension", async () => {
        const service = new NotificationService();
        const handle = service.show(message({ severity: "error", message: "boom" }));

        await expect(handle.answered).resolves.toBeUndefined();
        expect(service.passive().map((n) => n.message)).toEqual(["boom"]);
        expect(service.current()).toBeNull();
    });

    it("an identical live toast is replaced: moves to the end, with a fresh timer", () => {
        const service = new NotificationService();
        service.show(message({ message: "same" }));
        service.show(message({ message: "other" }));
        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS.info - 1);

        const again = service.show(message({ message: "same" }));

        expect(service.passive().map((n) => n.message)).toEqual(["other", "same"]);
        expect(service.passive()[1].id).toBe(again.id);

        vi.advanceTimersByTime(1);
        expect(service.passive().map((n) => n.message)).toEqual(["same"]);

        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS.info - 1);
        expect(service.passive().map((n) => n.message)).toEqual([]);
    });

    it.each([
        ["severity", { severity: "warn" }],
        ["message", { message: "different" }],
        ["detail", { detail: "more" }],
    ] as const)("a toast differing in %s is not a duplicate", (_name, patch) => {
        const service = new NotificationService();
        service.show(message());
        service.show(message(patch));

        expect(service.passive()).toHaveLength(2);
    });

    it("questions with the same text are not deduplicated: each asker waits for its own answer", () => {
        const service = new NotificationService();
        service.show(message({ items: ["Yes"] }));
        service.show(message({ items: ["Yes"] }));

        expect(service.queuedCount()).toBe(1);
    });

    it("lifetime depends on severity, upstream values", () => {
        const service = new NotificationService();
        service.show(message({ severity: "info", message: "i" }));
        service.show(message({ severity: "warn", message: "w" }));
        service.show(message({ severity: "error", message: "e" }));

        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS.info);
        expect(service.passive().map((n) => n.message)).toEqual(["w", "e"]);

        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS.warn - NOTIFICATION_AUTO_HIDE_MS.info);
        expect(service.passive().map((n) => n.message)).toEqual(["e"]);

        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS.error - NOTIFICATION_AUTO_HIDE_MS.warn);
        expect(service.passive()).toEqual([]);
    });

    it("a toast does not leave before its time", () => {
        const service = new NotificationService();
        service.show(message({ severity: "info" }));

        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS.info - 1);
        expect(service.passive()).toHaveLength(1);

        vi.advanceTimersByTime(1);
        expect(service.passive()).toEqual([]);
    });

    it("order is oldest to newest (the stack is drawn top to bottom)", () => {
        const service = new NotificationService();
        service.show(message({ message: "one" }));
        service.show(message({ message: "two" }));

        expect(service.passive().map((n) => n.message)).toEqual(["one", "two"]);
    });

    it("toasts over the limit WAIT FOR A SLOT instead of getting lost", () => {
        const service = new NotificationService();
        const many = ["one", "two", "three", "four", "five"];
        for (const text of many) service.show(message({ severity: "error", message: text }));

        expect(service.passive()).toHaveLength(MAX_VISIBLE_NOTIFICATIONS);
        expect(service.passive().map((n) => n.message)).toEqual(many.slice(0, MAX_VISIBLE_NOTIFICATIONS));
        expect(service.queuedPassiveCount()).toBe(many.length - MAX_VISIBLE_NOTIFICATIONS);
    });

    it("a waiting toast's lifetime starts at SHOW, not at enqueue", () => {
        const service = new NotificationService();
        for (const text of ["one", "two", "three", "four"]) {
            service.show(message({ severity: "info", message: text }));
        }
        expect(vi.getTimerCount()).toBe(MAX_VISIBLE_NOTIFICATIONS);

        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS.info);
        expect(service.passive().map((n) => n.message)).toEqual(["four"]);
        expect(service.queuedPassiveCount()).toBe(0);

        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS.info - 1);
        expect(service.passive()).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(service.passive()).toEqual([]);
    });

    it("closing a visible toast lets a waiting one take its place", () => {
        const service = new NotificationService();
        const first = service.show(message({ severity: "error", message: "one" }));
        for (const text of ["two", "three", "four"]) {
            service.show(message({ severity: "error", message: text }));
        }
        expect(service.passive().map((n) => n.message)).toEqual(["one", "two", "three"]);

        service.dismiss(first.id);

        expect(service.passive().map((n) => n.message)).toEqual(["two", "three", "four"]);
        expect(service.queuedPassiveCount()).toBe(0);
    });

    it("dismiss removes the toast and CLEARS its timer", () => {
        const service = new NotificationService();
        const handle = service.show(message());
        expect(vi.getTimerCount()).toBe(1);

        service.dismiss(handle.id);
        expect(service.passive()).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);

        service.dismiss(handle.id); // repeated call is a no-op
        expect(service.passive()).toEqual([]);
    });

    it("dismiss removes EXACTLY the addressed toast, not the first in the stack", () => {
        const service = new NotificationService();
        service.show(message({ severity: "error", message: "one" }));
        const second = service.show(message({ severity: "error", message: "two" }));

        service.dismiss(second.id);

        expect(service.passive().map((n) => n.message)).toEqual(["one"]);
    });

    it("dismiss by an unknown id removes nothing", () => {
        const service = new NotificationService();
        const handle = service.show(message({ severity: "error" }));

        service.dismiss(handle.id + 100);

        expect(service.passive()).toHaveLength(1);
    });

    it("clearAll clears the timers of all toasts, including those waiting for a slot", () => {
        const service = new NotificationService();
        for (const text of ["one", "two", "three", "four"]) service.show(message({ message: text }));
        expect(vi.getTimerCount()).toBe(MAX_VISIBLE_NOTIFICATIONS);

        service.clearAll();

        expect(vi.getTimerCount()).toBe(0);
        expect(service.isEmpty()).toBe(true);
    });

    it("dispose removes everything and leaves no timers", () => {
        const service = new NotificationService();
        service.show(message());
        expect(vi.getTimerCount()).toBe(1);

        service.dispose();

        expect(service.isEmpty()).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("dispose settles a live question as `closed without a choice`, otherwise the asker would wait forever", async () => {
        const service = new NotificationService();
        const handle = service.show(message({ items: ["One"] }));

        service.dispose();

        await expect(handle.answered).resolves.toBeUndefined();
    });

    it("isEmpty tells apart empty, a live toast and a live question", () => {
        const passiveOnly = new NotificationService();
        expect(passiveOnly.isEmpty()).toBe(true);
        passiveOnly.show(message({ severity: "error" }));
        expect(passiveOnly.isEmpty()).toBe(false);

        const askOnly = new NotificationService();
        askOnly.show(message({ items: ["One"] }));
        expect(askOnly.isEmpty()).toBe(false);
        expect(askOnly.passive()).toEqual([]);
    });

    it("a subscriber gets an event on show and on clear", () => {
        const service = new NotificationService();
        const seen = vi.fn();
        service.onDidChange(seen);

        const handle = service.show(message());
        expect(seen).toHaveBeenCalledTimes(1);

        service.dismiss(handle.id);
        expect(seen).toHaveBeenCalledTimes(2);
    });

    it("after unsubscribing no events arrive", () => {
        const service = new NotificationService();
        const seen = vi.fn();
        const subscription = service.onDidChange(seen);
        subscription.dispose();

        service.show(message());
        expect(seen).not.toHaveBeenCalled();
    });
});

describe("NotificationService: questions", () => {
    it("a question closes by itself if nobody answers: the extension does not wait forever", async () => {
        vi.useFakeTimers();
        try {
            const service = new NotificationService();
            const handle = service.show(message({ items: ["Activate"] }));

            // Outlives even the longest passive toast.
            vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS.error);
            expect(service.current()).not.toBeNull();

            vi.advanceTimersByTime(NOTIFICATION_ASK_TIMEOUT_MS - NOTIFICATION_AUTO_HIDE_MS.error);
            await expect(handle.answered).resolves.toBeUndefined();
            expect(service.current()).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("a queued question's time starts at SHOW", async () => {
        vi.useFakeTimers();
        try {
            const service = new NotificationService();
            const first = service.show(message({ message: "first", items: ["One"] }));
            const second = service.show(message({ message: "second", items: ["Two"] }));
            expect(vi.getTimerCount()).toBe(1);

            vi.advanceTimersByTime(NOTIFICATION_ASK_TIMEOUT_MS);
            await expect(first.answered).resolves.toBeUndefined();
            expect(service.current()?.message).toBe("second");

            vi.advanceTimersByTime(NOTIFICATION_ASK_TIMEOUT_MS - 1);
            expect(service.current()?.message).toBe("second");
            vi.advanceTimersByTime(1);
            await expect(second.answered).resolves.toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });

    it("a MODAL message has no timer: the window does not close out from under the user", () => {
        vi.useFakeTimers();
        try {
            const service = new NotificationService();
            service.show(message({ modal: true, items: ["Delete"] }));
            expect(vi.getTimerCount()).toBe(0);

            vi.advanceTimersByTime(NOTIFICATION_ASK_TIMEOUT_MS * 10);
            expect(service.current()).not.toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("an answer clears the question's timer", () => {
        vi.useFakeTimers();
        try {
            const service = new NotificationService();
            const handle = service.show(message({ items: ["One"] }));
            expect(vi.getTimerCount()).toBe(1);

            service.answer(handle.id, 0);

            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it("a message with buttons waits for an answer and returns the pressed index", async () => {
        const service = new NotificationService();
        const handle = service.show(message({ items: ["Activate", "Free"] }));

        expect(service.current()?.message).toBe("hello");
        expect(service.passive()).toEqual([]);

        service.answer(handle.id, 1);
        await expect(handle.answered).resolves.toBe(1);
        expect(service.current()).toBeNull();
    });

    it("closing without a choice returns undefined", async () => {
        const service = new NotificationService();
        const handle = service.show(message({ items: ["One"] }));

        service.dismiss(handle.id);
        await expect(handle.answered).resolves.toBeUndefined();
    });

    it("an index outside the button set is not an answer but a close", async () => {
        const service = new NotificationService();
        const handle = service.show(message({ items: ["One"] }));

        service.answer(handle.id, 5);
        await expect(handle.answered).resolves.toBeUndefined();
    });

    it("an index EQUAL to the set size is already out of range", async () => {
        const service = new NotificationService();
        const handle = service.show(message({ items: ["One", "Two"] }));

        service.answer(handle.id, 2);
        await expect(handle.answered).resolves.toBeUndefined();
    });

    it("a negative index is a close too", async () => {
        const service = new NotificationService();
        const handle = service.show(message({ items: ["One"] }));

        service.answer(handle.id, -1);
        await expect(handle.answered).resolves.toBeUndefined();
    });

    it("questions are shown one at a time: the second waits for the first to be answered", async () => {
        const service = new NotificationService();
        const first = service.show(message({ message: "first", items: ["One"] }));
        const second = service.show(message({ message: "second", items: ["Two"] }));

        expect(service.current()?.message).toBe("first");
        expect(service.queuedCount()).toBe(1);

        service.answer(first.id, 0);
        await expect(first.answered).resolves.toBe(0);
        expect(service.current()?.message).toBe("second");
        expect(service.queuedCount()).toBe(0);

        service.answer(second.id, 0);
        await expect(second.answered).resolves.toBe(0);
    });

    it("an answer to a queued question arrives without waiting for it to be shown", async () => {
        const service = new NotificationService();
        service.show(message({ message: "first", items: ["One"] }));
        const queued = service.show(message({ message: "second", items: ["Two"] }));

        service.answer(queued.id, 0);
        await expect(queued.answered).resolves.toBe(0);
        expect(service.current()?.message).toBe("first");
    });

    it("a close is addressed to EXACTLY its own question, not the shown one", async () => {
        const service = new NotificationService();
        const showing = service.show(message({ message: "first", items: ["One"] }));
        const queued = service.show(message({ message: "second", items: ["Two"] }));

        service.dismiss(queued.id);

        await expect(queued.answered).resolves.toBeUndefined();
        expect(service.current()?.message).toBe("first");
        expect(service.queuedCount()).toBe(0);
        service.answer(showing.id, 0);
        await expect(showing.answered).resolves.toBe(0);
    });

    it("an answer to an unknown id is a no-op", async () => {
        const service = new NotificationService();
        const handle = service.show(message({ items: ["One"] }));

        service.answer(handle.id + 100, 0);
        expect(service.current()?.id).toBe(handle.id);
    });

    it("a modal message skips the queue, otherwise it could go unnoticed", () => {
        const service = new NotificationService();
        service.show(message({ message: "toast question", items: ["One"] }));
        service.show(message({ message: "modal", modal: true, items: ["Delete"] }));

        expect(service.current()?.message).toBe("modal");
    });

    it("a modal without buttons is still a question: the user must close it themselves", async () => {
        const service = new NotificationService();
        const handle = service.show(message({ modal: true }));

        expect(service.current()?.message).toBe("hello");
        expect(service.passive()).toEqual([]);

        let settled = false;
        void handle.answered.then(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        service.dismiss(handle.id);
        await expect(handle.answered).resolves.toBeUndefined();
    });

    it("among modals the order is the usual FIFO", () => {
        const service = new NotificationService();
        service.show(message({ message: "modal one", modal: true }));
        service.show(message({ message: "modal two", modal: true }));

        expect(service.current()?.message).toBe("modal one");
        expect(service.queuedCount()).toBe(1);
    });
});

describe("NotificationService — clearAll", () => {
    it("removes everything and settles live questions as `closed without a choice`", async () => {
        const service = new NotificationService();
        const passive = service.show(message({ severity: "error", message: "boom" }));
        const ask = service.show(message({ items: ["One"] }));
        const queued = service.show(message({ items: ["Two"] }));

        service.clearAll();

        expect(service.isEmpty()).toBe(true);
        await expect(passive.answered).resolves.toBeUndefined();
        await expect(ask.answered).resolves.toBeUndefined();
        await expect(queued.answered).resolves.toBeUndefined();
    });

    it("works when there are no live toasts but a question is present", async () => {
        const service = new NotificationService();
        const ask = service.show(message({ items: ["One"] }));

        service.clearAll();

        await expect(ask.answered).resolves.toBeUndefined();
        expect(service.current()).toBeNull();
    });

    it("works when there is a toast but no questions", () => {
        const service = new NotificationService();
        service.show(message({ severity: "error" }));

        service.clearAll();

        expect(service.passive()).toEqual([]);
    });

    it("clears the timer of a live question, not only of toasts", () => {
        vi.useFakeTimers();
        try {
            const service = new NotificationService();
            service.show(message({ items: ["One"] }));
            expect(vi.getTimerCount()).toBe(1);

            service.clearAll();

            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it("does not fire the event on an empty service (nothing to redraw)", () => {
        const service = new NotificationService();
        const seen = vi.fn();
        service.onDidChange(seen);

        service.clearAll();
        expect(seen).not.toHaveBeenCalled();
    });

    it("fires the event when something was actually removed", () => {
        const service = new NotificationService();
        service.show(message());
        const seen = vi.fn();
        service.onDidChange(seen);

        service.clearAll();
        expect(seen).toHaveBeenCalledTimes(1);
    });
});
