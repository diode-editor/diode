import { describe, expect, it } from "vitest";

import { CORNER_ORDER, GroupCornerStack } from "./groupCornerStack.ts";

describe("GroupCornerStack", () => {
    it("the first widget sits under the tab strip; a shown slot pushes those after it down, a hidden one does not", () => {
        const corners = new GroupCornerStack();
        const toolbar = corners.addSlot(1, CORNER_ORDER.debugToolbar);

        expect(toolbar.top()).toBe(1);
        expect(corners.topOf(1, CORNER_ORDER.find)).toBe(1);

        toolbar.setHeight(3);
        expect(corners.topOf(1, CORNER_ORDER.find)).toBe(4);
        expect(toolbar.top()).toBe(1);

        toolbar.setHeight(0);
        expect(corners.topOf(1, CORNER_ORDER.find)).toBe(1);
    });

    it("a slot further down does not push the ones above it", () => {
        const corners = new GroupCornerStack();
        const lower = corners.addSlot(1, CORNER_ORDER.find);
        lower.setHeight(3);

        expect(corners.topOf(1, CORNER_ORDER.debugToolbar)).toBe(1);
        expect(lower.top()).toBe(1);
    });

    it("groups do not share a corner", () => {
        const corners = new GroupCornerStack();
        corners.addSlot(1, CORNER_ORDER.debugToolbar).setHeight(3);

        expect(corners.topOf(2, CORNER_ORDER.find)).toBe(1);
    });

    it("tells which group's corner changed; the same height again is not a change", () => {
        const corners = new GroupCornerStack();
        const changed: number[] = [];
        corners.onDidChange((groupId) => changed.push(groupId));
        const slot = corners.addSlot(7, CORNER_ORDER.debugToolbar);

        slot.setHeight(3);
        slot.setHeight(3);
        slot.setHeight(0);
        expect(changed).toEqual([7, 7]);
    });

    it("a disposed shown slot gives its rows back; a hidden one leaves quietly", () => {
        const corners = new GroupCornerStack();
        const changed: number[] = [];
        corners.onDidChange((groupId) => changed.push(groupId));
        const shown = corners.addSlot(1, CORNER_ORDER.debugToolbar);
        shown.setHeight(3);
        changed.length = 0;

        shown.dispose();
        expect(changed).toEqual([1]);
        expect(corners.topOf(1, CORNER_ORDER.find)).toBe(1);
        // A disposed slot no longer counts, whatever its owner reports afterwards.
        shown.setHeight(3);
        expect(corners.topOf(1, CORNER_ORDER.find)).toBe(1);

        changed.length = 0;
        corners.addSlot(1, CORNER_ORDER.debugToolbar).dispose();
        expect(changed).toEqual([]);
    });
});
