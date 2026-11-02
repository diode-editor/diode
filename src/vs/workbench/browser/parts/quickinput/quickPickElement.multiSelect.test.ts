import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { describe, expect, it, vi } from "vitest";

import { expectScreen, screen } from "../../../../../TestUtils/expectScreen.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";

import { QuickPickElement } from "./quickPickElement.ts";

function makePicker(width = 24): QuickPickElement {
    const picker = new QuickPickElement();
    picker.preferredWidth = width;
    picker.placeholder = "";
    return picker;
}

function render(picker: QuickPickElement, width = 24) {
    return renderElement(picker, width, picker.getMinIntrinsicHeight(width), { themeVars: true });
}

/** Sends the key straight to the widget, bypassing focus: we're testing its own key handling. */
function key(picker: QuickPickElement, name: string): void {
    picker.dispatchEvent(new TUIKeyboardEvent("keydown", { key: name }));
}

const ITEMS: QuickPickItem[] = [{ label: "alpha" }, { label: "beta" }, { label: "gamma" }];

describe("QuickPickElement — multi-select checkboxes", () => {
    it("without canPickMany there is no checkbox column at all", () => {
        const picker = makePicker();
        picker.items = ITEMS;
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │                      │
                ├──────────────────────┤
                │ alpha                │
                │ beta                 │
                │ gamma                │
                ╰──────────────────────╯
            `,
        );
    });

    it("with canPickMany every row has an empty checkbox", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │                      │
                ├──────────────────────┤
                │ [ ] alpha            │
                │ [ ] beta             │
                │ [ ] gamma            │
                ╰──────────────────────╯
            `,
        );
    });

    it("a checked row is drawn with a check mark", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        picker.setCheckedItems([ITEMS[1]]);
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │                      │
                ├──────────────────────┤
                │ [ ] alpha            │
                │ [✓] beta             │
                │ [ ] gamma            │
                ╰──────────────────────╯
            `,
        );
    });

    it("setCheckedItems replaces the whole set rather than adding to it", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        picker.setCheckedItems([ITEMS[0]]);
        picker.setCheckedItems([ITEMS[2]]);
        expect([...picker.checkedItems]).toEqual([ITEMS[2]]);
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │                      │
                ├──────────────────────┤
                │ [ ] alpha            │
                │ [ ] beta             │
                │ [✓] gamma            │
                ╰──────────────────────╯
            `,
        );
    });

    it("the icon and checkbox columns together shrink the label instead of overlapping", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = [{ icon: "T", label: "very-long-row-label-name" }];
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │                      │
                ├──────────────────────┤
                │ [ ] T very-long-row… │
                ╰──────────────────────╯
            `,
        );
    });

    it("Space toggles the check of the row under the cursor right in the frame", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        key(picker, " ");
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │                      │
                ├──────────────────────┤
                │ [✓] alpha            │
                │ [ ] beta             │
                │ [ ] gamma            │
                ╰──────────────────────╯
            `,
        );
    });

    it("the checkbox shrinks the label space instead of overlapping it", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = [{ label: "very-long-row-label-name" }];
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │                      │
                ├──────────────────────┤
                │ [ ] very-long-row-l… │
                ╰──────────────────────╯
            `,
        );
    });
});

describe("QuickPickElement — Space in multi-select", () => {
    it("Space checks the row, the active item and the show stay put", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        key(picker, "ArrowDown");
        key(picker, "ArrowDown");
        key(picker, " ");
        expect(picker.selectedIndex).toBe(1);
        expect([...picker.checkedItems]).toEqual([ITEMS[1]]);
    });

    it("a second Space unchecks", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        key(picker, " ");
        key(picker, " ");
        expect([...picker.checkedItems]).toEqual([]);
    });

    it("outside multi-select Space leaves the widget alone — it is a query character", () => {
        const picker = makePicker();
        picker.items = ITEMS;
        const event = new TUIKeyboardEvent("keydown", { key: " " });
        picker.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect([...picker.checkedItems]).toEqual([]);
    });

    it("in multi-select Space is consumed and does not reach the query row", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        const event = new TUIKeyboardEvent("keydown", { key: " " });
        picker.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it("Space after the query filtered everything out of an active row checks nothing", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        const onCheckedChange = vi.fn();
        picker.onCheckedChange = onCheckedChange;
        picker.moveActive(1); // alpha is active
        picker.refreshItems([]); // the active index stays, the list under it is gone

        key(picker, " ");

        expect([...picker.checkedItems]).toEqual([]);
        expect(onCheckedChange).not.toHaveBeenCalled();
    });

    it("Space on an empty list breaks nothing", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = [];
        expect(() => {
            key(picker, " ");
        }).not.toThrow();
        expect([...picker.checkedItems]).toEqual([]);
    });
});

describe("QuickPickElement — Enter in multi-select", () => {
    it("Enter calls onAcceptMany, not onAccept", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        let many = 0;
        let single = 0;
        picker.onAcceptMany = () => many++;
        picker.onAccept = () => single++;
        key(picker, "Enter");
        expect([many, single]).toEqual([1, 0]);
    });

    it("Enter fires on an empty list too", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = [];
        let many = 0;
        picker.onAcceptMany = () => many++;
        key(picker, "Enter");
        expect(many).toBe(1);
    });

    it("outside multi-select Enter still calls onAccept", () => {
        const picker = makePicker();
        picker.items = ITEMS;
        let accepted: QuickPickItem | null = null;
        picker.onAccept = (item) => {
            accepted = item;
        };
        picker.onAcceptMany = () => {
            throw new Error("onAcceptMany must not fire in single select");
        };
        key(picker, "Enter");
        expect(accepted).toBe(ITEMS[0]);
    });
});

describe("QuickPickElement.resetFlavorState", () => {
    it("clears the mode, checks and callback — checkboxes do not leak into the next show", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        picker.setCheckedItems([ITEMS[0]]);
        picker.onAcceptMany = () => undefined;

        picker.resetFlavorState();

        expect(picker.canPickMany).toBe(false);
        expect([...picker.checkedItems]).toEqual([]);
        expect(picker.onAcceptMany).toBeNull();
    });

    it("after a reset rows are drawn without the checkbox column", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        picker.setCheckedItems([ITEMS[0]]);
        picker.resetFlavorState();
        picker.items = ITEMS;
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │                      │
                ├──────────────────────┤
                │ alpha                │
                │ beta                 │
                │ gamma                │
                ╰──────────────────────╯
            `,
        );
    });

    it("after a reset Enter goes to onAccept again", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        picker.resetFlavorState();
        let accepted: QuickPickItem | null = null;
        picker.onAccept = (item) => {
            accepted = item;
        };
        key(picker, "Enter");
        expect(accepted).toBe(ITEMS[0]);
    });
});

describe("QuickPickElement — rebuilding rows keeps the screen in place", () => {
    function longList(): QuickPickItem[] {
        return Array.from({ length: 40 }, (_, i) => ({ label: `item-${String(i + 1).padStart(2, "0")}` }));
    }

    it("checking in a scrolled list does not scroll it back to the top", () => {
        const picker = makePicker(30);
        picker.canPickMany = true;
        picker.items = longList();
        render(picker, 30);
        for (let i = 0; i < 21; i++) key(picker, "ArrowDown");
        const scrolledIndex = picker.selectedIndex;
        expect(scrolledIndex).toBe(20);

        key(picker, " ");

        expect(picker.selectedIndex).toBe(scrolledIndex);
        expect([...picker.checkedItems].map((i) => i.label)).toEqual(["item-21"]);
        expect(picker.inspectState().checked).toEqual(["item-21"]);
    });

    it("checking does not wake the live preview — it is not navigation", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        key(picker, "ArrowDown");
        const onActive = vi.fn();
        picker.onActiveItemChanged = onActive;
        key(picker, " ");
        expect(onActive).not.toHaveBeenCalled();
    });
});

describe("QuickPickElement.inspectState — checks", () => {
    it("in multi-select returns the checked labels in list order", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        picker.setCheckedItems([ITEMS[2], ITEMS[0]]);
        expect(picker.inspectState().checked).toEqual(["alpha", "gamma"]);
    });

    it("in single select there is no checks field at all", () => {
        const picker = makePicker();
        picker.items = ITEMS;
        expect(picker.inspectState()).not.toHaveProperty("checked");
    });
});

describe("QuickPickElement — click in multi-select", () => {
    /** Engine mouse token (1-based coordinates, as in the terminal). */
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

    /** Screen row of the first item, after border(1) + query(2) + separator(3). */
    const FIRST_ROW_Y = 4;

    function mount(): { picker: QuickPickElement; app: TestApp } {
        const picker = makePicker(30);
        picker.canPickMany = true;
        picker.items = ITEMS;
        const app = TestApp.createWithContent(picker, new Size(30, picker.getMinIntrinsicHeight(30)));
        app.render();
        return { picker, app };
    }

    function click(app: TestApp, y: number): void {
        app.backend.simulateMouse(token({ action: "press", x: 5, y }));
        app.backend.simulateMouse(token({ action: "release", x: 5, y }));
    }

    it("clicking a row toggles its check instead of accepting the show", () => {
        const { picker, app } = mount();
        const onAcceptMany = vi.fn();
        picker.onAcceptMany = onAcceptMany;

        click(app, FIRST_ROW_Y + 1);

        expect([...picker.checkedItems]).toEqual([ITEMS[1]]);
        expect(onAcceptMany).not.toHaveBeenCalled();
    });

    it("a second click on the same row unchecks it", () => {
        const { picker, app } = mount();
        click(app, FIRST_ROW_Y);
        click(app, FIRST_ROW_Y);
        expect([...picker.checkedItems]).toEqual([]);
    });
});
