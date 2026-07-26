import { describe, expect, it } from "vitest";

import { renderElement } from "../../../src/TestUtils/renderElement.ts";
import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { RenderContext } from "../../dom/tuiElement.ts";
import { TerminalScreen } from "../../rendering/terminalScreen.ts";

import { StatusBarElement } from "./statusBarElement.ts";

function renderStatusBar(width: number, items: { text: string }[] = []): MockTerminalBackend {
    const bar = new StatusBarElement();
    bar.setItems(items);
    return renderElement(bar, width, 1, { constraints: BoxConstraints.tight(new Size(width, 10)) });
}

describe("StatusBarElement", () => {
    it("has height 1 regardless of constraints", () => {
        const bar = new StatusBarElement();
        const resultSize = bar.performLayout(BoxConstraints.tight(new Size(80, 24)));
        expect(resultSize.height).toBe(1);
        expect(resultSize.width).toBe(80);
    });

    it("renders empty bar with spaces", () => {
        const backend = renderStatusBar(10);
        const screenText = backend.screenToString().split("\n")[0];
        expect(screenText.trim()).toBe("");
    });

    it("renders single item text", () => {
        const backend = renderStatusBar(20, [{ text: "hello.ts" }]);
        const screenText = backend.screenToString().split("\n")[0];
        expect(screenText).toContain("hello.ts");
    });

    it("renders multiple items separated by double space", () => {
        const backend = renderStatusBar(30, [{ text: "file.ts" }, { text: "[Modified]" }]);
        const screenText = backend.screenToString().split("\n")[0];
        expect(screenText).toContain("file.ts  [Modified]");
    });

    it("setItems triggers markDirty", () => {
        const bar = new StatusBarElement();
        bar.performLayout(BoxConstraints.tight(new Size(40, 1)));
        expect(bar.isLayoutDirty).toBe(false);

        bar.setItems([{ text: "test" }]);
        expect(bar.isLayoutDirty).toBe(true);
    });

    it("getItems returns current items", () => {
        const bar = new StatusBarElement();
        expect(bar.getItems()).toEqual([]);

        const items = [{ text: "a" }, { text: "b" }];
        bar.setItems(items);
        expect(bar.getItems()).toEqual(items);
    });

    it("truncates text that exceeds width", () => {
        const backend = renderStatusBar(5, [{ text: "longtext" }]);
        const screenText = backend.screenToString().split("\n")[0];
        expect(screenText.length).toBeLessThanOrEqual(5);
    });

    it("insets both sides by the bar padding, left items winning on overlap", () => {
        const bar = new StatusBarElement();
        bar.setItems([{ text: "left" }, { text: "Ln 1, Col 1", align: "right" }]);
        const backend = renderElement(bar, 20, 1);

        const line = backend.screenToString().split("\n")[0];
        expect(line.length).toBe(20);
        expect(line.startsWith(" left")).toBe(true);
        // The trailing padding cell keeps the last character out of the
        // bottom-right corner the renderer never writes.
        expect(line.endsWith("Ln 1, Col 1 ")).toBe(true);
    });

    function renderLine(width: number, items: { text: string; align?: "left" | "right" }[]): string {
        const bar = new StatusBarElement();
        bar.setItems(items);
        return renderElement(bar, width, 1).screenToString().split("\n")[0];
    }

    it("lets the left item win the cells a right item would overlap", () => {
        // width 10, left "LLLLLL" at cells 1–6, right "RGHT" (4) → rightStart=5,
        // cells 5–6 belong to the left item, only 7–8 ("HT") are drawn for the
        // right item; cells 0 and 9 are the bar padding.
        const line = renderLine(10, [{ text: "LLLLLL" }, { text: "RGHT", align: "right" }]);
        expect(line).toBe(" LLLLLLHT ");
    });

    it("clips a right item that is wider than the bar at the left padding", () => {
        // width 5, right "TOOLONG" (7) → rightStart=-3, everything left of the
        // content area is skipped; "ONG" survives at cells 1–3, cells 0 and 4
        // are the bar padding.
        const line = renderLine(5, [{ text: "TOOLONG", align: "right" }]);
        expect(line).toBe(" ONG ");
    });

    it("intrinsic width sums the bar padding, left, a two-space gap and right", () => {
        const bar = new StatusBarElement();
        bar.setItems([{ text: "abc" }, { text: "xy", align: "right" }]);
        // padding (1) + "abc" (3) + gap (2) + "xy" (2) + padding (1) = 9
        expect(bar.getMinIntrinsicWidth(1)).toBe(9);
        expect(bar.getMaxIntrinsicWidth(1)).toBe(9);
    });

    it("renders with correct offset", () => {
        const size = new Size(20, 3);
        const backend = new MockTerminalBackend(size);
        const termScreen = new TerminalScreen(size);
        const bar = new StatusBarElement();
        bar.globalPosition = new Point(0, 2);
        bar.setItems([{ text: "bottom" }]);
        bar.performLayout(BoxConstraints.tight(new Size(20, 10)));
        bar.render(new RenderContext(termScreen, new Offset(0, 2)));
        termScreen.flush(backend);

        const lines = backend.screenToString().split("\n");
        expect(lines[2]).toContain("bottom");
    });
});
