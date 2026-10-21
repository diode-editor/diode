import { describe, expect, it } from "vitest";

import { currentCursorChangeSource, withCursorChangeSource } from "./cursorChangeSource.ts";

describe("cursorChangeSource", () => {
    it("no source is declared outside a scope", () => {
        expect(currentCursorChangeSource()).toBeUndefined();
    });

    it("the declared source is visible inside the scope, nothing after it", () => {
        const inside = withCursorChangeSource("mouse", () => currentCursorChangeSource());
        expect(inside).toBe("mouse");
        expect(currentCursorChangeSource()).toBeUndefined();
    });

    it("returns the value of the given function", () => {
        expect(withCursorChangeSource("keyboard", () => 42)).toBe(42);
    });

    it("a nested scope does not override the outer one: a keybinding running a command stays keyboard", () => {
        const seen = withCursorChangeSource("keyboard", () =>
            withCursorChangeSource("command", () => currentCursorChangeSource()),
        );
        expect(seen).toBe("keyboard");
    });

    it("the outer scope is restored after leaving the nested one", () => {
        const trail: (string | undefined)[] = [];
        withCursorChangeSource("mouse", () => {
            withCursorChangeSource("command", () => trail.push(currentCursorChangeSource()));
            trail.push(currentCursorChangeSource());
        });
        trail.push(currentCursorChangeSource());
        expect(trail).toEqual(["mouse", "mouse", undefined]);
    });

    it("an exception from the function does not leave the source armed", () => {
        expect(() =>
            withCursorChangeSource("command", () => {
                throw new Error("boom");
            }),
        ).toThrow("boom");
        expect(currentCursorChangeSource()).toBeUndefined();
    });

    it("the async tail is outside the scope — the source does not leak past await", async () => {
        let afterAwait: string | undefined = "unset";
        await withCursorChangeSource("command", async () => {
            await Promise.resolve();
            afterAwait = currentCursorChangeSource();
        });
        expect(afterAwait).toBeUndefined();
    });
});
