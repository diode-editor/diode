import { describe, expect, it } from "vitest";

import { KittyKeyboardState } from "./kittyKeyboardState.ts";

// Upstream semantics (xterm.js 6.1 `InputHandler.kittyKeyboard*`); the sequences reach it from a real emulator in
// xtermSurface.kitty.test.ts.

describe("KittyKeyboardState", () => {
    it("starts at 0 and answers the query with the flags", () => {
        const state = new KittyKeyboardState();
        expect(state.flags).toBe(0);
        expect(state.query()).toBe("\x1b[?0u");
        state.set(29, 1);
        expect(state.query()).toBe("\x1b[?29u");
    });

    it.each([
        [1, 6],
        [2, 7],
        [3, 1],
        [4, 3],
        [0, 3],
    ])("set with mode %i on flags 3 and value 6 → %i", (mode, expected) => {
        const state = new KittyKeyboardState();
        state.set(3, 1);
        state.set(6, mode);
        expect(state.flags).toBe(expected);
    });

    it("push saves the flags, pop restores them; an emptied stack leaves 0", () => {
        const state = new KittyKeyboardState();
        state.set(5, 1);
        state.push(1);
        state.push(3);
        expect(state.flags).toBe(3);
        state.pop(1);
        expect(state.flags).toBe(1);
        state.pop(1);
        expect(state.flags).toBe(0);
        state.pop(1);
        expect(state.flags).toBe(0);
    });

    it("pops at least one entry and stops at the bottom", () => {
        const state = new KittyKeyboardState();
        state.push(1);
        state.push(3);
        state.push(7);
        state.pop(0);
        expect(state.flags).toBe(3);
        state.pop(-2);
        expect(state.flags).toBe(1);
        state.push(2);
        state.push(4);
        state.pop(2);
        expect(state.flags).toBe(1);
        state.pop(9);
        expect(state.flags).toBe(0);
    });

    it("keeps 16 entries, evicting the oldest", () => {
        const state = new KittyKeyboardState();
        for (let flags = 1; flags <= 17; flags++) state.push(flags);
        state.pop(15);
        expect(state.flags).toBe(2);
        state.pop(1);
        expect(state.flags).toBe(0);
    });

    it("16 pushes keep the initial entry", () => {
        const state = new KittyKeyboardState();
        for (let flags = 1; flags <= 16; flags++) state.push(flags);
        state.pop(15);
        expect(state.flags).toBe(1);
        state.pop(1);
        expect(state.flags).toBe(0);
    });

    it("each screen has its own flags and stack", () => {
        const state = new KittyKeyboardState();
        state.push(1);
        state.switchScreen(true);
        expect(state.flags).toBe(0);
        state.push(3);
        state.push(5);
        state.switchScreen(false);
        expect(state.flags).toBe(1);
        state.switchScreen(true);
        expect(state.flags).toBe(5);
        state.pop(1);
        expect(state.flags).toBe(3);
        state.switchScreen(false);
        state.pop(1);
        expect(state.flags).toBe(0);
        state.switchScreen(true);
        expect(state.flags).toBe(3);
    });

    it("switching to the screen already active changes nothing", () => {
        const state = new KittyKeyboardState();
        state.set(9, 1);
        state.switchScreen(false);
        expect(state.flags).toBe(9);
        state.switchScreen(true);
        state.set(4, 1);
        state.switchScreen(true);
        expect(state.flags).toBe(4);
        state.switchScreen(false);
        expect(state.flags).toBe(9);
    });

    it("reset drops the flags of both screens and both stacks", () => {
        const state = new KittyKeyboardState();
        state.push(1);
        state.switchScreen(true);
        state.push(3);
        state.reset();
        expect(state.flags).toBe(0);
        state.push(8);
        state.pop(1);
        expect(state.flags).toBe(0);
        state.switchScreen(false);
        expect(state.flags).toBe(0);
        state.push(2);
        state.pop(1);
        expect(state.flags).toBe(0);
    });
});
