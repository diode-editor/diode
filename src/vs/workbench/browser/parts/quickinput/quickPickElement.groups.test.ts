import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { describe, expect, it } from "vitest";

import { expectScreen, screen } from "../../../../../TestUtils/expectScreen.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";

import { QuickPickElement } from "./quickPickElement.ts";

// Registry defaults of upstream `quickpickColors.ts`: Dark+ sets neither.
const GROUP_BORDER = 0x3f3f46;
const GROUP_LABEL = 0x3794ff;
const ACTIVE_SELECTION_FG = 0xffffff;

function makePicker(items: readonly QuickPickItem[], width = 30): QuickPickElement {
    const picker = new QuickPickElement();
    picker.preferredWidth = width;
    picker.placeholder = "";
    picker.items = items;
    return picker;
}

function render(picker: QuickPickElement, width = 30) {
    return renderElement(picker, width, picker.getMinIntrinsicHeight(width), { themeVars: true });
}

/** The probe extension's `Pick Grouped` list, after the extension host attached its separators. */
function groupedItems(): QuickPickItem[] {
    return [
        { label: "apple", separatorLabel: "Fruits" },
        { label: "banana" },
        { label: "carrot", separatorLabel: "" },
        { label: "leek", separatorLabel: "Vegetables" },
    ];
}

/** `count` groups of `size` items, each group labelled `G<n>`. */
function groups(count: number, size: number): QuickPickItem[] {
    return Array.from({ length: count * size }, (_, i) => ({
        label: `item-${String(i)}`,
        ...(i % size === 0 ? { separatorLabel: `G${String(i / size)}` } : {}),
    }));
}

function token(overrides: Partial<MouseToken>): MouseToken {
    return {
        kind: "mouse",
        action: "press",
        button: "left",
        x: 1,
        y: 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
        ...overrides,
    };
}

function mount(picker: QuickPickElement): TestApp {
    const app = TestApp.createWithContent(picker, new Size(30, picker.getMinIntrinsicHeight(30)));
    app.render();
    return app;
}

/** Straight to the widget, bypassing focus: its own key handling is under test. */
function key(picker: QuickPickElement, name: string): void {
    picker.dispatchEvent(new TUIKeyboardEvent("keydown", { key: name }));
}

// 1-based: border(1) + query(2) + frame separator(3) + first list line(4).
const FIRST_LINE_Y = 4;

describe("QuickPickElement — groups", () => {
    it("a line above a group, its label on the right of the first item; none above the first row", () => {
        expectScreen(
            render(makePicker(groupedItems())),
            screen`
                ╭────────────────────────────╮
                │                            │
                ├────────────────────────────┤
                │ apple               Fruits │
                │ banana                     │
                │────────────────────────────│
                │ carrot                     │
                │────────────────────────────│
                │ leek            Vegetables │
                ╰────────────────────────────╯
            `,
        );
    });

    it("the line is drawn in pickerGroup.border, the label in pickerGroup.foreground", () => {
        const backend = render(makePicker([{ label: "a" }, { label: "b", separatorLabel: "Group" }]));

        expect(backend.getFgAt(new Point(1, 4))).toBe(GROUP_BORDER);
        expect(backend.getFgAt(new Point(28, 4))).toBe(GROUP_BORDER);
        expect(backend.getFgAt(new Point(24, 5))).toBe(GROUP_LABEL);
    });

    it("on the active row the label takes the selection foreground, as the other metadata", () => {
        const backend = render(makePicker([{ label: "a", separatorLabel: "Group" }, { label: "b" }]));

        expect(backend.getFgAt(new Point(24, 3))).toBe(ACTIVE_SELECTION_FG);
    });

    it("the label is shown in full while the label of the item shrinks, then it is cut at its end", () => {
        const narrow = render(makePicker([{ label: "a-very-long-label", separatorLabel: "Group", hint: "hint" }], 24));
        expect(narrow.getTextAt(new Point(0, 3), 24)).toBe("│ a-very…  hint  Group │");

        const tiny = render(makePicker([{ label: "label", separatorLabel: "Vegetables" }], 12));
        expect(tiny.getTextAt(new Point(0, 3), 12)).toBe("│ …  Vege… │");
    });

    it("with groups hidden neither lines nor labels are drawn", () => {
        const picker = new QuickPickElement();
        picker.preferredWidth = 30;
        picker.placeholder = "";
        picker.groupsVisible = false;
        picker.items = groupedItems();

        expectScreen(
            render(picker),
            screen`
                ╭────────────────────────────╮
                │                            │
                ├────────────────────────────┤
                │ apple                      │
                │ banana                     │
                │ carrot                     │
                │ leek                       │
                ╰────────────────────────────╯
            `,
        );
    });

    it("lines count in the height: three groups of three take ten lines and scroll", () => {
        const picker = makePicker(groups(3, 3));
        // 9 items + 2 lines = 11 → 10 visible lines between the frame (3 above, 1 below).
        expect(picker.getMinIntrinsicHeight(30)).toBe(14);

        const app = mount(picker);
        key(picker, "ArrowUp");
        for (let i = 0; i < 8; i++) key(picker, "ArrowDown");
        app.render();
        // The last frame line above the bottom border holds the last item.
        expect(app.backend.getTextAt(new Point(2, 12), 6)).toBe("item-8");
        // 11 lines in 10: the list scrolled by one.
        expect(app.backend.getTextAt(new Point(2, 3), 6)).toBe("item-1");
    });

    it("a short list has no empty tail: two items and a line are three lines", () => {
        expect(makePicker([{ label: "a" }, { label: "b", separatorLabel: "" }]).getMinIntrinsicHeight(30)).toBe(7);
    });

    it("PageDown steps by the items in view, not by its lines", () => {
        const picker = makePicker(groups(5, 3));
        const app = mount(picker);

        // Lines 0..9 hold items 0..7 (lines 3 and 7 are group lines).
        key(picker, "PageDown");
        expect(picker.selectedIndex).toBe(8);
    });

    it("a click on a line picks nothing, a click on the item below it picks that item", () => {
        const picker = makePicker([{ label: "a" }, { label: "b", separatorLabel: "Group" }]);
        const accepted: string[] = [];
        picker.onAccept = (item) => accepted.push(item.label);
        const app = mount(picker);

        app.backend.simulateMouse(token({ x: 5, y: FIRST_LINE_Y + 1 }));
        app.backend.simulateMouse(token({ action: "release", x: 5, y: FIRST_LINE_Y + 1 }));
        expect(accepted).toEqual([]);
        expect(picker.selectedIndex).toBe(0);

        app.backend.simulateMouse(token({ x: 5, y: FIRST_LINE_Y + 2 }));
        app.backend.simulateMouse(token({ action: "release", x: 5, y: FIRST_LINE_Y + 2 }));
        expect(accepted).toEqual(["b"]);
    });

    it("hover over a line leaves the active row where it is", () => {
        const picker = makePicker([{ label: "a" }, { label: "b", separatorLabel: "Group" }]);
        const app = mount(picker);

        app.backend.simulateMouse(token({ action: "move", x: 5, y: FIRST_LINE_Y + 1 }));
        expect(picker.selectedIndex).toBe(0);
        app.backend.simulateMouse(token({ action: "move", x: 5, y: FIRST_LINE_Y + 2 }));
        expect(picker.selectedIndex).toBe(1);
    });

    it("the wheel scrolls by lines with the group lines counted, and a click after it hits the item under it", () => {
        const picker = makePicker(groups(4, 3));
        const accepted: string[] = [];
        picker.onAccept = (item) => accepted.push(item.label);
        const app = mount(picker);

        app.backend.simulateMouse(token({ action: "scroll-down", button: "none", x: 5, y: FIRST_LINE_Y }));
        app.render();
        // Three lines down is the group line under item-2: the scroll snaps to the row that line belongs to.
        expect(app.backend.getTextAt(new Point(2, FIRST_LINE_Y - 1), 6)).toBe("item-2");

        app.backend.simulateMouse(token({ x: 5, y: FIRST_LINE_Y + 3 }));
        app.backend.simulateMouse(token({ action: "release", x: 5, y: FIRST_LINE_Y + 3 }));
        // item-2, the line, item-3, item-4.
        expect(accepted).toEqual(["item-4"]);
    });

    it("multi-select: checkboxes on items only; Space on an item under a line checks that item", () => {
        const picker = new QuickPickElement();
        picker.preferredWidth = 30;
        picker.placeholder = "";
        picker.canPickMany = true;
        const items = groupedItems();
        picker.items = items;
        const app = mount(picker);

        for (let i = 0; i < 3; i++) key(picker, "ArrowDown");
        key(picker, " ");
        app.render();

        expect([...picker.checkedItems]).toEqual([items[2]]);
        expect(app.backend.getTextAt(new Point(0, 5), 30)).toBe(`│${"─".repeat(28)}│`);
        expect(app.backend.getTextAt(new Point(0, 6), 12)).toBe("│ [✓] carrot");
    });
});
