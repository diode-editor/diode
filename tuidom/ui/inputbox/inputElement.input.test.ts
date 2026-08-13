import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../testing/TestApp.ts";
import { Size } from "../../common/geometryPromitives.ts";

import { InputElement } from "./inputElement.ts";
import { InputState } from "./inputState.ts";

function createApp(input: InputElement, size: Size = new Size(40, 3)): TestApp {
    const testApp = TestApp.createWithContent(input, size);
    input.focus();
    return testApp;
}

// ─── InputState unit tests (pure model, no UI) ──────────────────────────────

describe("InputState", () => {
    describe("insert", () => {
        it("inserts text at cursor position", () => {
            const state = new InputState();
            state.insert("a");
            expect(state.text).toBe("a");
            expect(state.cursorOffset).toBe(1);
        });

        it("inserts in the middle", () => {
            const state = new InputState();
            state.value = "ac";
            state.moveCursorLeft();
            state.insert("b");
            expect(state.text).toBe("abc");
            expect(state.cursorOffset).toBe(2);
        });

        it("inserts at beginning", () => {
            const state = new InputState();
            state.value = "bc";
            state.moveCursorToStart();
            state.insert("a");
            expect(state.text).toBe("abc");
            expect(state.cursorOffset).toBe(1);
        });
    });

    describe("deleteLeft (Backspace)", () => {
        it("deletes character to the left of cursor", () => {
            const state = new InputState();
            state.value = "ab";
            state.deleteLeft();
            expect(state.text).toBe("a");
            expect(state.cursorOffset).toBe(1);
        });

        it("is a no-op at the start of text", () => {
            const state = new InputState();
            state.value = "abc";
            state.moveCursorToStart();
            state.deleteLeft();
            expect(state.text).toBe("abc");
            expect(state.cursorOffset).toBe(0);
        });

        it("deletes the only character", () => {
            const state = new InputState();
            state.value = "x";
            state.deleteLeft();
            expect(state.text).toBe("");
            expect(state.cursorOffset).toBe(0);
        });

        it("deletes character in the middle", () => {
            const state = new InputState();
            state.value = "abc";
            state.moveCursorLeft();
            state.deleteLeft();
            expect(state.text).toBe("ac");
            expect(state.cursorOffset).toBe(1);
        });
    });

    describe("deleteRight (Delete key)", () => {
        it("deletes character to the right of cursor", () => {
            const state = new InputState();
            state.value = "ab";
            state.moveCursorToStart();
            state.deleteRight();
            expect(state.text).toBe("b");
            expect(state.cursorOffset).toBe(0);
        });

        it("is a no-op at the end of text", () => {
            const state = new InputState();
            state.value = "abc";
            state.deleteRight();
            expect(state.text).toBe("abc");
            expect(state.cursorOffset).toBe(3);
        });

        it("deletes character in the middle", () => {
            const state = new InputState();
            state.value = "abc";
            state.moveCursorLeft();
            state.moveCursorLeft();
            state.deleteRight(); // delete 'b'
            expect(state.text).toBe("ac");
            expect(state.cursorOffset).toBe(1);
        });
    });

    describe("moveCursorLeft", () => {
        it("moves cursor left by one grapheme", () => {
            const state = new InputState();
            state.value = "abc";
            state.moveCursorLeft();
            expect(state.cursorOffset).toBe(2);
        });

        it("is a no-op at the start", () => {
            const state = new InputState();
            state.value = "abc";
            state.moveCursorToStart();
            state.moveCursorLeft();
            expect(state.cursorOffset).toBe(0);
        });
    });

    describe("moveCursorRight", () => {
        it("moves cursor right by one grapheme", () => {
            const state = new InputState();
            state.value = "abc";
            state.moveCursorToStart();
            state.moveCursorRight();
            expect(state.cursorOffset).toBe(1);
        });

        it("is a no-op at the end", () => {
            const state = new InputState();
            state.value = "abc";
            state.moveCursorRight();
            expect(state.cursorOffset).toBe(3);
        });
    });

    describe("moveCursorToStart / moveCursorToEnd", () => {
        it("moves to start", () => {
            const state = new InputState();
            state.value = "hello";
            state.moveCursorToStart();
            expect(state.cursorOffset).toBe(0);
        });

        it("moves to end", () => {
            const state = new InputState();
            state.value = "hello";
            state.moveCursorToStart();
            state.moveCursorToEnd();
            expect(state.cursorOffset).toBe(5);
        });
    });

    describe("value setter", () => {
        it("replaces text and places cursor at end", () => {
            const state = new InputState();
            state.value = "hello";
            expect(state.text).toBe("hello");
            expect(state.cursorOffset).toBe(5);
        });

        it("setting empty string resets cursor to 0", () => {
            const state = new InputState();
            state.value = "hello";
            state.value = "";
            expect(state.text).toBe("");
            expect(state.cursorOffset).toBe(0);
        });
    });

    describe("emoji / multibyte grapheme clusters", () => {
        it("deleteLeft removes entire emoji", () => {
            const state = new InputState();
            state.value = "a\uD83D\uDE00"; // a😀 — emoji is 2 code units
            state.deleteLeft();
            expect(state.text).toBe("a");
            expect(state.cursorOffset).toBe(1);
        });

        it("moveCursorLeft skips over entire emoji", () => {
            const state = new InputState();
            state.value = "a\uD83D\uDE00"; // a😀
            state.moveCursorLeft();
            expect(state.cursorOffset).toBe(1); // cursor is now after 'a'
        });
    });
});

// ─── InputElement keyboard integration tests (via TestApp) ──────────────────

describe("InputElement — keyboard input", () => {
    it("types characters into the input", () => {
        const input = new InputElement();
        const testApp = createApp(input);
        testApp.sendKey("a");
        testApp.sendKey("b");
        testApp.sendKey("c");
        expect(input.inputState.text).toBe("abc");
    });

    it("calls onChange with updated value on each keystroke", () => {
        const input = new InputElement();
        const onChange = vi.fn();
        input.onChange = onChange;
        const testApp = createApp(input);
        testApp.sendKey("x");
        expect(onChange).toHaveBeenCalledWith("x");
        testApp.sendKey("y");
        expect(onChange).toHaveBeenCalledWith("xy");
    });

    it("handles Backspace", () => {
        const input = new InputElement();
        const testApp = createApp(input);
        testApp.sendKey("a");
        testApp.sendKey("b");
        testApp.sendKey("Backspace");
        expect(input.inputState.text).toBe("a");
    });

    it("calls onChange on Backspace", () => {
        const input = new InputElement();
        const onChange = vi.fn();
        input.onChange = onChange;
        const testApp = createApp(input);
        testApp.sendKey("a");
        testApp.sendKey("Backspace");
        expect(onChange).toHaveBeenLastCalledWith("");
    });

    it("Backspace at start is a no-op", () => {
        const input = new InputElement();
        const testApp = createApp(input);
        testApp.sendKey("Backspace"); // nothing to delete
        expect(input.inputState.text).toBe("");
    });

    it("handles Delete key", () => {
        const input = new InputElement();
        const testApp = createApp(input);
        testApp.sendKey("a");
        testApp.sendKey("b");
        testApp.sendKey("ArrowLeft"); // cursor between a and b
        testApp.sendKey("Delete");
        expect(input.inputState.text).toBe("a");
    });

    it("Delete at end is a no-op", () => {
        const input = new InputElement();
        const testApp = createApp(input);
        testApp.sendKey("a");
        testApp.sendKey("Delete");
        expect(input.inputState.text).toBe("a");
        expect(input.inputState.cursorOffset).toBe(1);
    });

    it("ArrowLeft moves cursor left", () => {
        const input = new InputElement();
        const testApp = createApp(input);
        testApp.sendKey("a");
        testApp.sendKey("b");
        testApp.sendKey("ArrowLeft");
        expect(input.inputState.cursorOffset).toBe(1);
    });

    it("ArrowRight moves cursor right", () => {
        const input = new InputElement();
        const testApp = createApp(input);
        testApp.sendKey("a");
        testApp.sendKey("b");
        testApp.sendKey("ArrowLeft");
        testApp.sendKey("ArrowRight");
        expect(input.inputState.cursorOffset).toBe(2);
    });

    it("Home moves cursor to start", () => {
        const input = new InputElement();
        const testApp = createApp(input);
        testApp.sendKey("a");
        testApp.sendKey("b");
        testApp.sendKey("c");
        testApp.sendKey("Home");
        expect(input.inputState.cursorOffset).toBe(0);
    });

    it("End moves cursor to end", () => {
        const input = new InputElement();
        const testApp = createApp(input);
        testApp.sendKey("a");
        testApp.sendKey("b");
        testApp.sendKey("Home");
        testApp.sendKey("End");
        expect(input.inputState.cursorOffset).toBe(2);
    });

    it("inserts at cursor position (not always at end)", () => {
        const input = new InputElement();
        const testApp = createApp(input);
        testApp.sendKey("a");
        testApp.sendKey("c");
        testApp.sendKey("ArrowLeft"); // between a and c
        testApp.sendKey("b");
        expect(input.inputState.text).toBe("abc");
    });

    it("does not insert Ctrl+key combinations", () => {
        const input = new InputElement();
        const testApp = createApp(input);
        testApp.sendKey("Ctrl+C");
        expect(input.inputState.text).toBe("");
    });

    it("does not react to keys when not focused", () => {
        const input = new InputElement();
        const testApp = createApp(input);
        input.blur();
        testApp.sendKey("a");
        expect(input.inputState.text).toBe("");
    });
});
