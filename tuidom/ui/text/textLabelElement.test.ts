import { describe, expect, it } from "vitest";

import { renderElement } from "../../../src/TestUtils/renderElement.ts";
import type { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { DEFAULT_COLOR } from "../../common/colorUtils.ts";
import { Point } from "../../common/geometryPromitives.ts";

import { TextLabelElement } from "./textLabelElement.ts";

function render(label: TextLabelElement, width: number): MockTerminalBackend {
    return renderElement(label, width, 1, { resolveStyles: true });
}

describe("TextLabelElement", () => {
    it("exposes the original text via getText()", () => {
        const label = new TextLabelElement("hello");
        expect(label.getText()).toBe("hello");
    });

    it("updates text via setText() and re-renders the new value", () => {
        const label = new TextLabelElement("old");
        label.setText("new");
        expect(label.getText()).toBe("new");

        const backend = render(label, 5);
        expect(backend.getTextAt(new Point(0, 0), 3)).toBe("new");
    });

    it("reports min intrinsic width equal to the display width of the text", () => {
        const label = new TextLabelElement("abcde");
        expect(label.getMinIntrinsicWidth(1)).toBe(5);
        expect(label.getMaxIntrinsicWidth(1)).toBe(5);
    });

    it("reports a single-row min/max intrinsic height", () => {
        const label = new TextLabelElement("abc");
        expect(label.getMinIntrinsicHeight(10)).toBe(1);
        expect(label.getMaxIntrinsicHeight(10)).toBe(1);
    });

    it("renders per-character styles on the targeted offset", () => {
        const label = new TextLabelElement("abc");
        label.setCharStyle(1, { fg: 42 });

        const backend = render(label, 3);

        expect(backend.getTextAt(new Point(0, 0), 3)).toBe("abc");
        expect(backend.getFgAt(new Point(1, 0))).toBe(42);
    });

    it("renders with DEFAULT_COLOR when no colors are set", () => {
        const label = new TextLabelElement("hi");

        const backend = render(label, 2);
        expect(backend.getTextAt(new Point(0, 0), 2)).toBe("hi");
        expect(backend.getFgAt(new Point(0, 0))).toBe(DEFAULT_COLOR);
        expect(backend.getBgAt(new Point(0, 0))).toBe(DEFAULT_COLOR);
    });

    it("applies colors set via setColors()", () => {
        const label = new TextLabelElement("ab");
        label.setColors(7, 9);

        const backend = render(label, 2);
        expect(backend.getFgAt(new Point(0, 0))).toBe(7);
        expect(backend.getBgAt(new Point(0, 0))).toBe(9);
    });

    it("clearCharStyles() removes previous per-character styles", () => {
        const label = new TextLabelElement("ab");
        label.setCharStyle(1, { fg: 55 });
        label.clearCharStyles();

        const backend = render(label, 2);
        // The cleared char style at offset 1 falls back to the default fg.
        expect(backend.getFgAt(new Point(1, 0))).toBe(DEFAULT_COLOR);
    });
});
