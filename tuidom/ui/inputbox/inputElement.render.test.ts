import { describe, expect, it } from "vitest";

import { renderElement } from "../../../src/TestUtils/renderElement.ts";
import type { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { RenderContext } from "../../dom/tuiElement.ts";
import { TerminalScreen } from "../../rendering/terminalScreen.ts";

import { InputElement } from "./inputElement.ts";
import { InputState } from "./inputState.ts";

function renderInput(input: InputElement, width: number): MockTerminalBackend {
    const height = input.showBorder ? 3 : 1;
    return renderElement(input, width, height, { resolveStyles: true });
}

describe("InputElement — layout", () => {
    it("has height 1 without border", () => {
        const input = new InputElement();
        input.layout(BoxConstraints.tight(new Size(20, 1)));
        expect(input.layoutSize.height).toBe(1);
    });

    it("has height 3 with border", () => {
        const input = new InputElement();
        input.showBorder = true;
        input.layout(BoxConstraints.tight(new Size(20, 3)));
        expect(input.layoutSize.height).toBe(3);
    });

    it("takes the given width", () => {
        const input = new InputElement();
        input.layout(BoxConstraints.tight(new Size(30, 1)));
        expect(input.layoutSize.width).toBe(30);
    });

    it("returns correct minIntrinsicHeight", () => {
        const input = new InputElement();
        expect(input.getMinIntrinsicHeight(20)).toBe(1);
        input.showBorder = true;
        expect(input.getMinIntrinsicHeight(20)).toBe(3);
    });

    it("returns correct maxIntrinsicHeight", () => {
        const input = new InputElement();
        expect(input.getMaxIntrinsicHeight(20)).toBe(1);
        input.showBorder = true;
        expect(input.getMaxIntrinsicHeight(20)).toBe(3);
    });

    it("returns correct minIntrinsicWidth (border branch on line 59)", () => {
        const input = new InputElement();
        expect(input.getMinIntrinsicWidth(1)).toBe(3);
        input.showBorder = true;
        expect(input.getMinIntrinsicWidth(1)).toBe(5);
    });

    it("returns correct minIntrinsicHeight for both border states", () => {
        const input = new InputElement();
        expect(input.getMinIntrinsicHeight(20)).toBe(1);
        input.showBorder = true;
        expect(input.getMinIntrinsicHeight(20)).toBe(3);
    });

    it("falls back to max(minWidth, 20) when maxWidth is unbounded (line 72 else branch)", () => {
        const input = new InputElement();
        // Non-finite maxWidth → width is max(minWidth, 20). minWidth 10 < 20 ⇒ 20.
        input.layout(new BoxConstraints(10, Infinity, 1, 1));
        expect(input.layoutSize.width).toBe(20);
    });

    it("uses minWidth when it exceeds 20 under an unbounded maxWidth", () => {
        const input = new InputElement();
        input.layout(new BoxConstraints(25, Infinity, 1, 1));
        expect(input.layoutSize.width).toBe(25);
    });
});

describe("InputElement — degenerate content width", () => {
    it("returns early without drawing when the content area collapses to zero width (line 89)", () => {
        const input = new InputElement();
        input.showBorder = true;
        input.inputState.value = "hi";
        // Total width 2 with a border ⇒ contentWidth = 2 - 2 = 0 ⇒ render bails out at line 89.
        expect(() => renderInput(input, 2)).not.toThrow();
    });
});

describe("InputElement — rendering without border", () => {
    it("renders text at row 0", () => {
        const input = new InputElement();
        input.inputState.value = "hello";
        const backend = renderInput(input, 20);
        const row = backend.getTextAt(new Point(0, 0), 20);
        expect(row).toContain("hello");
    });

    it("renders text from column 0", () => {
        const input = new InputElement();
        input.inputState.value = "abc";
        const backend = renderInput(input, 20);
        const row = backend.getTextAt(new Point(0, 0), 3);
        expect(row).toBe("abc");
    });

    it("renders placeholder when text is empty", () => {
        const input = new InputElement();
        input.placeholder = "Search…";
        const backend = renderInput(input, 20);
        const row = backend.getTextAt(new Point(0, 0), 20);
        expect(row).toContain("Search");
    });

    it("does not show placeholder when text is present", () => {
        const input = new InputElement();
        input.placeholder = "Search…";
        input.inputState.value = "hello";
        const backend = renderInput(input, 20);
        const row = backend.getTextAt(new Point(0, 0), 20);
        expect(row).toContain("hello");
        expect(row).not.toContain("Search");
    });

    it("renders empty when text is empty and no placeholder", () => {
        const input = new InputElement();
        const backend = renderInput(input, 10);
        const row = backend.getTextAt(new Point(0, 0), 10);
        expect(row.trim()).toBe("");
    });
});

describe("InputElement — rendering with border", () => {
    it("renders top-left corner ╭", () => {
        const input = new InputElement();
        input.showBorder = true;
        const backend = renderInput(input, 10);
        expect(backend.getTextAt(new Point(0, 0), 1)).toBe("╭");
    });

    it("renders top-right corner ╮", () => {
        const input = new InputElement();
        input.showBorder = true;
        const backend = renderInput(input, 10);
        expect(backend.getTextAt(new Point(9, 0), 1)).toBe("╮");
    });

    it("renders bottom-left corner ╰", () => {
        const input = new InputElement();
        input.showBorder = true;
        const backend = renderInput(input, 10);
        expect(backend.getTextAt(new Point(0, 2), 1)).toBe("╰");
    });

    it("renders bottom-right corner ╯", () => {
        const input = new InputElement();
        input.showBorder = true;
        const backend = renderInput(input, 10);
        expect(backend.getTextAt(new Point(9, 2), 1)).toBe("╯");
    });

    it("renders left side border │", () => {
        const input = new InputElement();
        input.showBorder = true;
        const backend = renderInput(input, 10);
        expect(backend.getTextAt(new Point(0, 1), 1)).toBe("│");
    });

    it("renders right side border │", () => {
        const input = new InputElement();
        input.showBorder = true;
        const backend = renderInput(input, 10);
        expect(backend.getTextAt(new Point(9, 1), 1)).toBe("│");
    });

    it("renders text on row 1 (inside border)", () => {
        const input = new InputElement();
        input.showBorder = true;
        input.inputState.value = "hello";
        const backend = renderInput(input, 15);
        const innerRow = backend.getTextAt(new Point(1, 1), 13);
        expect(innerRow).toContain("hello");
    });

    it("renders placeholder on row 1 when empty", () => {
        const input = new InputElement();
        input.showBorder = true;
        input.placeholder = "Type here";
        const backend = renderInput(input, 20);
        const innerRow = backend.getTextAt(new Point(1, 1), 18);
        expect(innerRow).toContain("Type here");
    });

    it("top border uses ─ between corners", () => {
        const input = new InputElement();
        input.showBorder = true;
        const backend = renderInput(input, 6);
        // columns 1..4 should be ─
        const topMid = backend.getTextAt(new Point(1, 0), 4);
        expect(topMid).toBe("────");
    });
});

describe("InputElement — horizontal scroll", () => {
    it("shows end of text when cursor is at end of long text", () => {
        const state = new InputState();
        state.value = "AAABBBCCC"; // cursor at end
        const input = new InputElement(state);
        const backend = renderInput(input, 6); // width=6, text=9 chars
        // Cursor is at offset 9, scrollX should be >= 4 to show cursor
        // Row should show last part of text, not the beginning "AAA"
        const row = backend.getTextAt(new Point(0, 0), 6);
        expect(row).toContain("C");
        expect(row).not.toBe("AAABBB");
    });

    it("shows beginning when cursor is at start", () => {
        const state = new InputState();
        state.value = "AAABBBCCC";
        state.moveCursorToStart();
        const input = new InputElement(state);
        const backend = renderInput(input, 6);
        const row = backend.getTextAt(new Point(0, 0), 6);
        expect(row).toContain("A");
    });

    it("shifts scrollX right when cursor is past the right edge (lines 96-97)", () => {
        // contentWidth = 4, text 10 chars, cursor at end (offset 10, col 10).
        // scrollX must become 10 - 4 + 1 = 7 so the tail "HIJ" is visible.
        const state = new InputState();
        state.value = "ABCDEFGHIJ";
        const input = new InputElement(state);
        const backend = renderInput(input, 4);
        const row = backend.getTextAt(new Point(0, 0), 4);
        expect(row).toContain("J");
        expect(row).not.toContain("A");
    });

    it("scrolls back left when the cursor moves left of scrollX (line 95)", () => {
        // Same element rendered twice: first with cursor at end (scrollX advances),
        // then after moving the cursor to the start, which is < scrollX and must reset it.
        const state = new InputState();
        state.value = "ABCDEFGHIJ";
        const input = new InputElement(state);

        // First render: cursor at the end drives scrollX > 0.
        renderInput(input, 4);

        // Move cursor to the very start; cursorCol (0) is now < scrollX.
        state.moveCursorToStart();
        const backend = renderInput(input, 4);
        const row = backend.getTextAt(new Point(0, 0), 4);
        // Head of the text is revealed again (scrollX reset to 0).
        expect(row).toBe("ABCD");
    });
});

describe("InputElement — cursor position", () => {
    it("sets cursor position when input is rendered with isFocused via termScreen", () => {
        // Without a FocusManager, isFocused is always false and cursor is not set.
        // This test verifies that cursorPosition remains null when not focused.
        const input = new InputElement();
        input.inputState.value = "hi";
        const size = new Size(20, 1);
        const termScreen = new TerminalScreen(size);
        input.localPosition = new Offset(0, 0);
        input.layout(BoxConstraints.tight(size));
        input.render(new RenderContext(termScreen));
        // Not focused → no cursor set
        expect(termScreen.cursorPosition).toBeNull();
    });
});
