import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";

import { QuickPickElement } from "./quickPickElement.ts";

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

function makeItems(count: number): QuickPickItem[] {
    return Array.from({ length: count }, (_, i) => ({ label: `file-${String(i + 1)}.ts` }));
}

/** Goes through a real tree rather than dispatchEvent: the picker catches events bubbling up from list rows. */
function mount(items: QuickPickItem[]): { picker: QuickPickElement; app: TestApp } {
    const picker = new QuickPickElement();
    picker.preferredWidth = 30;
    picker.placeholder = "";
    picker.items = items;
    const app = TestApp.createWithContent(picker, new Size(30, picker.getMinIntrinsicHeight(30)));
    app.render();
    return { picker, app };
}

const FIRST_ROW_Y = 4; // 1-based: border(1) + query(2) + separator(3) + first item(4)

describe("QuickPickElement — mouse", () => {
    it("hover moves the selection along", () => {
        const { picker, app } = mount(makeItems(3));
        expect(picker.selectedIndex).toBe(0);

        app.backend.simulateMouse(token({ action: "move", x: 5, y: FIRST_ROW_Y + 2 }));
        expect(picker.selectedIndex).toBe(2);
    });

    it("hover does not wake the live preview — it is not navigation", () => {
        const { picker, app } = mount(makeItems(3));
        const onActive = vi.fn();
        picker.onActiveItemChanged = onActive;

        app.backend.simulateMouse(token({ action: "move", x: 5, y: FIRST_ROW_Y + 1 }));
        expect(picker.selectedIndex).toBe(1);
        expect(onActive).not.toHaveBeenCalled();
    });

    it("clicking a row selects and accepts it", () => {
        const { picker, app } = mount(makeItems(3));
        const onAccept = vi.fn();
        picker.onAccept = onAccept;

        app.backend.simulateMouse(token({ action: "press", x: 5, y: FIRST_ROW_Y + 1 }));
        app.backend.simulateMouse(token({ action: "release", x: 5, y: FIRST_ROW_Y + 1 }));

        expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({ label: "file-2.ts" }), 1);
    });

    it("clicking the query row or the border accepts nothing", () => {
        const { picker, app } = mount(makeItems(3));
        const onAccept = vi.fn();
        picker.onAccept = onAccept;

        app.backend.simulateMouse(token({ action: "press", x: 5, y: 2 }));
        app.backend.simulateMouse(token({ action: "release", x: 5, y: 2 }));

        expect(onAccept).not.toHaveBeenCalled();
    });

    it("the right button does not accept a row — it is a context menu event", () => {
        const { picker, app } = mount(makeItems(3));
        const onAccept = vi.fn();
        picker.onAccept = onAccept;

        app.backend.simulateMouse(token({ action: "press", button: "right", x: 5, y: FIRST_ROW_Y }));
        app.backend.simulateMouse(token({ action: "release", button: "right", x: 5, y: FIRST_ROW_Y }));

        expect(onAccept).not.toHaveBeenCalled();
    });

    it("the mouse outside the list does not move the selection", () => {
        const { picker, app } = mount(makeItems(3));
        app.backend.simulateMouse(token({ action: "move", x: 5, y: FIRST_ROW_Y + 1 }));
        expect(picker.selectedIndex).toBe(1);

        app.backend.simulateMouse(token({ action: "move", x: 5, y: 2 }));
        expect(picker.selectedIndex).toBe(1);
    });

    it("on an empty list the mouse changes nothing", () => {
        const { picker, app } = mount([]);
        const onAccept = vi.fn();
        picker.onAccept = onAccept;

        app.backend.simulateMouse(token({ action: "move", x: 5, y: 2 }));
        app.backend.simulateMouse(token({ action: "press", x: 5, y: 2 }));
        app.backend.simulateMouse(token({ action: "release", x: 5, y: 2 }));

        expect(picker.selectedIndex).toBe(0);
        expect(onAccept).not.toHaveBeenCalled();
    });

    it("clicking below the last row of the list accepts nothing", () => {
        const { picker, app } = mount(makeItems(2));
        const onAccept = vi.fn();
        picker.onAccept = onAccept;
        // The list shrinks to its row count, but we still check a click past the last row.
        app.backend.simulateMouse(token({ action: "press", x: 5, y: FIRST_ROW_Y + 5 }));
        app.backend.simulateMouse(token({ action: "release", x: 5, y: FIRST_ROW_Y + 5 }));

        expect(onAccept).not.toHaveBeenCalled();
    });

    it("clicking a row is blocked by a hard validation error", () => {
        const { picker, app } = mount(makeItems(3));
        const onAccept = vi.fn();
        picker.onAccept = onAccept;
        picker.validationMessage = "Name is taken";
        app.render();

        // The message line pushed the list down by one row.
        app.backend.simulateMouse(token({ action: "press", x: 5, y: FIRST_ROW_Y + 1 }));
        app.backend.simulateMouse(token({ action: "release", x: 5, y: FIRST_ROW_Y + 1 }));

        expect(onAccept).not.toHaveBeenCalled();
    });
});
