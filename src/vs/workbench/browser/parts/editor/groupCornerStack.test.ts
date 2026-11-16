import { describe, expect, it } from "vitest";

import { CORNER_ORDER, GroupCornerStack } from "./groupCornerStack.ts";

describe("GroupCornerStack", () => {
    it("the first slot sits under the tab strip; a shown one pushes those after it down, a hidden one does not", () => {
        const corners = new GroupCornerStack();
        const find = corners.addSlot(1, CORNER_ORDER.find);
        const toolbar = corners.addSlot(1, CORNER_ORDER.debugToolbar);

        expect(toolbar.top()).toBe(1);
        expect(find.top()).toBe(1);

        toolbar.setHeight(3);
        expect(find.top()).toBe(4);
        expect(toolbar.top()).toBe(1);

        find.setHeight(3);
        toolbar.setHeight(0);
        expect(find.top()).toBe(1);
    });

    it("groups do not share a corner", () => {
        const corners = new GroupCornerStack();
        corners.addSlot(1, CORNER_ORDER.debugToolbar).setHeight(3);
        const other = corners.addSlot(2, CORNER_ORDER.find);

        expect(other.top()).toBe(1);
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

    it("a disposed shown slot gives its rows back; a hidden one leaves quietly; a second dispose is a no-op", () => {
        const corners = new GroupCornerStack();
        const changed: number[] = [];
        corners.onDidChange((groupId) => changed.push(groupId));
        const toolbar = corners.addSlot(1, CORNER_ORDER.debugToolbar);
        const find = corners.addSlot(1, CORNER_ORDER.find);
        toolbar.setHeight(3);
        changed.length = 0;

        toolbar.dispose();
        expect(changed).toEqual([1]);
        expect(find.top()).toBe(1);
        toolbar.dispose();
        find.dispose();
        expect(changed).toEqual([1]);

        // The group's corner starts over empty.
        const again = corners.addSlot(1, CORNER_ORDER.find);
        expect(again.top()).toBe(1);
    });
});
