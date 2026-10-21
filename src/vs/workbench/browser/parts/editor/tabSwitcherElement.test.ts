import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { expectScreen, screen } from "../../../../../TestUtils/expectScreen.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";

import { TabSwitcherElement, type TabSwitcherItem } from "./tabSwitcherElement.ts";

const ICON_COLOR = packRgb(49, 120, 198);

function item(label: string, overrides: Partial<TabSwitcherItem> = {}): TabSwitcherItem {
    // An ASCII "icon" instead of a nerd font glyph keeps the expected frame readable.
    return { icon: "T", iconColor: ICON_COLOR, label, isModified: false, ...overrides };
}

function makeSwitcher(width = 24): TabSwitcherElement {
    const switcher = new TabSwitcherElement();
    switcher.preferredWidth = width;
    return switcher;
}

function render(switcher: TabSwitcherElement, width = 24) {
    return renderElement(switcher, width, switcher.totalHeight, { themeVars: true });
}

describe("TabSwitcherElement — layout", () => {
    it("box, one row per tab: icon, label, dirty marker on the right", () => {
        const switcher = makeSwitcher(24);
        switcher.setItems([item("a.ts"), item("b.ts", { isModified: true })], 1);

        expectScreen(
            render(switcher, 24),
            screen`
                ╭──────────────────────╮
                │ T a.ts               │
                │ T b.ts             ● │
                ╰──────────────────────╯
            `,
        );
    });

    it("the cycle position is highlighted with the list selection color across the row", () => {
        const switcher = makeSwitcher(24);
        switcher.setItems([item("a.ts"), item("b.ts")], 1);

        const backend = render(switcher, 24);
        // Row 2 (b.ts) is selected, row 1 has the picker background: compare them to each other
        // so the test does not hardcode theme RGB values.
        const plainBg = backend.getBgAt(new Point(5, 1));
        const currentBg = backend.getBgAt(new Point(5, 2));
        expect(currentBg).not.toBe(plainBg);
        // The unselected row gets the picker background (like the border), the selected one does not:
        // this pins WHICH row is highlighted, not just that "the rows differ".
        const frameBg = backend.getBgAt(new Point(5, 0));
        expect(plainBg).toBe(frameBg);
        expect(backend.getBgAt(new Point(21, 2))).toBe(currentBg);
    });

    it("a long label is truncated to the row budget", () => {
        const switcher = makeSwitcher(16);
        switcher.setItems([item("veryLongFileName.ts")], 0);

        const backend = render(switcher, 16);
        const line = backend.screenToString().split("\n")[1];
        expect(line).toContain("…");
        expect(line).not.toContain("veryLongFileName.ts");
    });

    it("a long label does not eat the dirty marker: the label budget accounts for its column", () => {
        const switcher = makeSwitcher(16);
        switcher.setItems([item("veryLongFileName.ts", { isModified: true })], 0);

        // 16 columns: border 2 + padding 2 + icon 2 + marker 2 → 8 left for the label.
        expectScreen(
            render(switcher, 16),
            screen`
                ╭──────────────╮
                │ T veryLon… ● │
                ╰──────────────╯
            `,
        );
    });

    it("the maxVisibleItems-row window follows the cycle position and wraps back to the start", () => {
        const switcher = makeSwitcher(24);
        switcher.maxVisibleItems = 3;
        const items = Array.from({ length: 5 }, (_, i) => item(`f${String(i)}.ts`));

        switcher.setItems(items, 1);
        expect(switcher.inspectState()).toMatchObject({ currentIndex: 1, windowStart: 0 });

        switcher.setItems(items, 3);
        expect(switcher.inspectState()).toMatchObject({ currentIndex: 3, windowStart: 1 });

        expectScreen(
            render(switcher, 24),
            screen`
                ╭──────────────────────╮
                │ T f1.ts              │
                │ T f2.ts              │
                │ T f3.ts              │
                ╰──────────────────────╯
            `,
        );

        switcher.setItems(items, 2);
        expect(switcher.inspectState()).toMatchObject({ currentIndex: 2, windowStart: 1 });

        switcher.setItems(items, 0);
        expect(switcher.inspectState()).toMatchObject({ currentIndex: 0, windowStart: 0 });
    });

    it("the window does not scroll past the last page and the position is clamped", () => {
        const switcher = makeSwitcher(24);
        switcher.maxVisibleItems = 3;
        const items = Array.from({ length: 4 }, (_, i) => item(`f${String(i)}.ts`));

        switcher.setItems(items, 99);
        expect(switcher.inspectState()).toMatchObject({ currentIndex: 3, windowStart: 1 });
    });

    it("the list shrank — the window moves back within the new last page", () => {
        const switcher = makeSwitcher(24);
        switcher.maxVisibleItems = 3;
        const five = Array.from({ length: 5 }, (_, i) => item(`f${String(i)}.ts`));
        switcher.setItems(five, 4);
        expect(switcher.inspectState()).toMatchObject({ windowStart: 2 });

        // A new cycle with three tabs: the old windowStart=2 is out of bounds (3 rows
        // fit them all), so clamping to the last page brings it back to 0.
        switcher.setItems(five.slice(0, 3), 2);
        expect(switcher.inspectState()).toMatchObject({ currentIndex: 2, windowStart: 0 });
    });

    it("a fresh element is empty: no rows before the first cycle, height is just the box", () => {
        const switcher = makeSwitcher(24);
        expect(switcher.inspectState()).toEqual({ items: [], currentIndex: 0, windowStart: 0 });
        expect(switcher.totalHeight).toBe(2);
    });

    it("the icon keeps its file color instead of inheriting the row color", () => {
        const switcher = makeSwitcher(24);
        switcher.setItems([item("a.ts")], 0);

        const backend = render(switcher, 24);
        expect(backend.getFgAt(new Point(2, 1))).toBe(ICON_COLOR);
        expect(backend.getFgAt(new Point(4, 1))).not.toBe(ICON_COLOR);
    });

    it("inspectState returns row labels — observable state for e2e", () => {
        const switcher = makeSwitcher(24);
        switcher.setItems([item("a.ts"), item("b.ts")], 0);
        expect(switcher.inspectState()).toEqual({
            items: ["a.ts", "b.ts"],
            currentIndex: 0,
            windowStart: 0,
        });
    });
});
