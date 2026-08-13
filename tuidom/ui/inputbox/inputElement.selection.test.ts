import { describe, expect, it } from "vitest";

import { renderElement } from "../../testing/renderElement.ts";
import type { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { Point } from "../../common/geometryPromitives.ts";

import { InputElement } from "./inputElement.ts";
import { InputState } from "./inputState.ts";

const SELECTION_BG = packRgb(0x26, 0x4f, 0x78); // #264F78
const INPUT_BG = packRgb(60, 60, 60);

function renderInput(input: InputElement, width: number): MockTerminalBackend {
    const height = input.showBorder ? 3 : 1;
    return renderElement(input, width, height, { resolveStyles: true });
}

describe("InputElement — getMinIntrinsicWidth", () => {
    it("returns 3 without border", () => {
        const input = new InputElement();
        expect(input.getMinIntrinsicWidth(1)).toBe(3);
    });

    it("returns 5 with border", () => {
        const input = new InputElement();
        input.showBorder = true;
        expect(input.getMinIntrinsicWidth(3)).toBe(5);
    });
});

describe("InputElement — selection rendering", () => {
    it("renders all selected characters when selectAll() is active", () => {
        const state = new InputState();
        state.value = "hello";
        state.selectAll();
        const input = new InputElement(state);

        const backend = renderInput(input, 20);

        expect(backend.getTextAt(new Point(0, 0), 5)).toBe("hello");
    });

    it("paints selection background on every selected cell", () => {
        const state = new InputState();
        state.value = "hello";
        state.selectAll();
        const input = new InputElement(state);

        const backend = renderInput(input, 20);

        for (let x = 0; x < 5; x++) {
            expect(backend.getBgAt(new Point(x, 0))).toBe(SELECTION_BG);
        }
    });

    it("renders an unselected prefix with the input background, only the tail with selection bg", () => {
        const state = new InputState();
        state.value = "abcdef";
        // Cursor is at end (offset 6). Select 3 chars left → selects "def".
        state.selectLeft();
        state.selectLeft();
        state.selectLeft();
        const input = new InputElement(state);

        const backend = renderInput(input, 20);

        // Whole text still rendered.
        expect(backend.getTextAt(new Point(0, 0), 6)).toBe("abcdef");

        // Prefix "abc" keeps the normal input background.
        for (let x = 0; x < 3; x++) {
            expect(backend.getBgAt(new Point(x, 0))).toBe(INPUT_BG);
        }
        // Selected "def" carries the selection background.
        for (let x = 3; x < 6; x++) {
            expect(backend.getBgAt(new Point(x, 0))).toBe(SELECTION_BG);
        }
    });

    it("renders a trailing unselected suffix without selection bg", () => {
        const state = new InputState();
        state.value = "abcdef";
        state.moveCursorToStart();
        // Select 3 chars right from the start → selects "abc".
        state.selectRight();
        state.selectRight();
        state.selectRight();
        const input = new InputElement(state);

        const backend = renderInput(input, 20);

        expect(backend.getTextAt(new Point(0, 0), 6)).toBe("abcdef");

        // Selected "abc".
        for (let x = 0; x < 3; x++) {
            expect(backend.getBgAt(new Point(x, 0))).toBe(SELECTION_BG);
        }
        // Suffix "def" is not selected.
        for (let x = 3; x < 6; x++) {
            expect(backend.getBgAt(new Point(x, 0))).toBe(INPUT_BG);
        }
    });

    it("renders a middle selection: before + selected + after all present (lines 151-168)", () => {
        const state = new InputState();
        state.value = "abcdef";
        state.moveCursorToStart();
        state.moveCursorRight(); // cursor after "a"
        state.selectRight();
        state.selectRight();
        state.selectRight(); // selects "bcd"
        const input = new InputElement(state);

        const backend = renderInput(input, 20);

        expect(backend.getTextAt(new Point(0, 0), 6)).toBe("abcdef");
        // before "a"
        expect(backend.getBgAt(new Point(0, 0))).toBe(INPUT_BG);
        // selected "bcd"
        for (let x = 1; x < 4; x++) {
            expect(backend.getBgAt(new Point(x, 0))).toBe(SELECTION_BG);
        }
        // after "ef"
        for (let x = 4; x < 6; x++) {
            expect(backend.getBgAt(new Point(x, 0))).toBe(INPUT_BG);
        }
    });

    it("selection at the very start has no 'before' segment (before.length === 0)", () => {
        const state = new InputState();
        state.value = "abcdef";
        state.moveCursorToStart();
        state.selectRight();
        state.selectRight(); // selects "ab" from offset 0
        const input = new InputElement(state);

        const backend = renderInput(input, 20);

        expect(backend.getTextAt(new Point(0, 0), 6)).toBe("abcdef");
        // selected "ab"
        expect(backend.getBgAt(new Point(0, 0))).toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(1, 0))).toBe(SELECTION_BG);
        // after "cdef"
        expect(backend.getBgAt(new Point(2, 0))).toBe(INPUT_BG);
    });

    it("selection extending to the end has no 'after' segment (after.length === 0)", () => {
        const state = new InputState();
        state.value = "abcdef"; // cursor at end
        state.selectLeft();
        state.selectLeft(); // selects "ef" up to the end
        const input = new InputElement(state);

        const backend = renderInput(input, 20);

        expect(backend.getTextAt(new Point(0, 0), 6)).toBe("abcdef");
        // before "abcd"
        expect(backend.getBgAt(new Point(0, 0))).toBe(INPUT_BG);
        expect(backend.getBgAt(new Point(3, 0))).toBe(INPUT_BG);
        // selected "ef"
        expect(backend.getBgAt(new Point(4, 0))).toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(5, 0))).toBe(SELECTION_BG);
    });

    it("renders selection inside a bordered input on the inner row", () => {
        const state = new InputState();
        state.value = "wxyz";
        state.selectAll();
        const input = new InputElement(state);
        input.showBorder = true;

        const backend = renderInput(input, 12);

        // Inner content starts at column 1, row 1.
        expect(backend.getTextAt(new Point(1, 1), 4)).toBe("wxyz");
        for (let x = 1; x <= 4; x++) {
            expect(backend.getBgAt(new Point(x, 1))).toBe(SELECTION_BG);
        }
    });
});

describe("InputElement — horizontal scroll mid-text", () => {
    it("scrolls so the cursor stays visible after the cursor moves into the middle", () => {
        const state = new InputState();
        state.value = "ABCDEFGHIJ"; // 10 chars, cursor at end (offset 10)
        const input = new InputElement(state);

        // Render in a narrow viewport — cursor at end forces scrollX > 0.
        const backend = renderInput(input, 5);
        const rowAtEnd = backend.getTextAt(new Point(0, 0), 5);
        // End of text must be visible, beginning scrolled off.
        expect(rowAtEnd).toContain("J");
        expect(rowAtEnd).not.toContain("A");

        // Now move the cursor back to the start; re-render reuses the same element
        // so scrollX must shift back left to reveal the beginning.
        state.moveCursorToStart();
        const backend2 = renderInput(input, 5);
        const rowAtStart = backend2.getTextAt(new Point(0, 0), 5);
        expect(rowAtStart).toContain("A");
        expect(rowAtStart).not.toContain("J");
    });
});
