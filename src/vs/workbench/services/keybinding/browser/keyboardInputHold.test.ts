import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";

import { attachKeyboardInputHold } from "./keyboardInputHold.ts";

function deferred(): { promise: Promise<void>; resolve: () => void; reject: () => void } {
    let resolve = (): void => undefined;
    let reject = (): void => undefined;
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function setup() {
    const commands = new CommandRegistry();
    const view = new TUIElement();
    const seen: string[] = [];
    const record = (event: TUIKeyboardEvent): void => {
        seen.push(`${event.type}:${event.key}`);
    };
    // After it, as in the workbench: on the target itself listeners run in subscription order.
    const attachment = attachKeyboardInputHold(view, commands);
    view.addEventListener("keydown", record);
    view.addEventListener("keypress", record);
    const send = (type: "keydown" | "keypress", key: string): TUIKeyboardEvent => {
        const event = new TUIKeyboardEvent(type, { key, code: `Code${key}`, shiftKey: true, raw: `raw${key}` });
        view.dispatchEvent(event);
        return event;
    };
    return { commands, view, seen, attachment, send };
}

describe("attachKeyboardInputHold", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("lets keys through while nothing holds them", () => {
        const { seen, send } = setup();
        const event = send("keydown", "a");
        expect(seen).toEqual(["keydown:a"]);
        expect(event.defaultPrevented).toBe(false);
    });

    it("keeps keys back during a hold, stops them, and replays them in order with their fields", async () => {
        const { commands, view, seen, send } = setup();
        const replayed: TUIKeyboardEvent[] = [];
        view.addEventListener("keypress", (event) => replayed.push(event));
        const done = deferred();
        commands.holdInputUntil(done.promise);

        const first = send("keydown", "a");
        send("keypress", "a");
        send("keydown", "b");

        expect(seen).toEqual([]);
        expect(first.defaultPrevented).toBe(true);

        done.resolve();
        await done.promise;
        await Promise.resolve();

        expect(seen).toEqual(["keydown:a", "keypress:a", "keydown:b"]);
        expect(replayed[0]).toMatchObject({ key: "a", code: "Codea", shiftKey: true, ctrlKey: false, raw: "rawa" });
    });

    it("a failed command releases the keys too", async () => {
        const { commands, seen, send } = setup();
        const done = deferred();
        commands.holdInputUntil(done.promise);
        send("keydown", "a");

        done.reject();
        await done.promise.catch(() => undefined);
        await Promise.resolve();

        expect(seen).toEqual(["keydown:a"]);
    });

    it("a replayed key that starts a new hold leaves the rest waiting for it", async () => {
        const { commands, view, seen, send } = setup();
        const second = deferred();
        view.addEventListener("keydown", (event) => {
            if (event.key === "a") commands.holdInputUntil(second.promise);
        });
        const first = deferred();
        commands.holdInputUntil(first.promise);
        send("keydown", "a");
        send("keydown", "b");

        first.resolve();
        await first.promise;
        await Promise.resolve();
        expect(seen).toEqual(["keydown:a"]);

        second.resolve();
        await second.promise;
        await Promise.resolve();
        expect(seen).toEqual(["keydown:a", "keydown:b"]);
    });

    it("goes to the focused element of the root, not to the view", async () => {
        const { commands, view, send } = setup();
        const focused = new TUIElement();
        const dispatch = vi.spyOn(focused, "dispatchEvent");
        vi.spyOn(view, "getRoot").mockReturnValue({ focusManager: { activeElement: focused } } as never);
        const done = deferred();
        commands.holdInputUntil(done.promise);
        send("keydown", "a");

        done.resolve();
        await done.promise;
        await Promise.resolve();

        expect(dispatch).toHaveBeenCalledOnce();
    });

    it("a stuck command gives the keyboard back after the limit", () => {
        vi.useFakeTimers();
        const { commands, seen, send } = setup();
        commands.holdInputUntil(new Promise(() => undefined));
        send("keydown", "a");

        vi.advanceTimersByTime(999);
        expect(seen).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(seen).toEqual(["keydown:a"]);
        expect(commands.isInputHeld).toBe(false);
    });

    it("two holds: keys wait for both, and a late answer after the limit changes nothing", async () => {
        vi.useFakeTimers();
        const { commands, seen, send } = setup();
        const a = deferred();
        const b = deferred();
        commands.holdInputUntil(a.promise);
        commands.holdInputUntil(b.promise);
        send("keydown", "x");

        a.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(seen).toEqual([]);
        expect(commands.isInputHeld).toBe(true);

        vi.advanceTimersByTime(1000);
        expect(seen).toEqual(["keydown:x"]);

        const c = deferred();
        commands.holdInputUntil(c.promise);
        b.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(commands.isInputHeld).toBe(true);
        c.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(commands.isInputHeld).toBe(false);
    });

    it("dispose detaches it: keys pass during a hold and nothing is replayed", async () => {
        const { commands, seen, attachment, send } = setup();
        const done = deferred();
        commands.holdInputUntil(done.promise);
        send("keydown", "a");
        attachment.dispose();
        send("keydown", "b");
        send("keypress", "c");
        expect(seen).toEqual(["keydown:b", "keypress:c"]);

        done.resolve();
        await done.promise;
        await Promise.resolve();
        expect(seen).toEqual(["keydown:b", "keypress:c"]);
    });
});
