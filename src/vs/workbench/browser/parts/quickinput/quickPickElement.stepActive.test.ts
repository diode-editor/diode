import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { describe, expect, it, vi } from "vitest";

import type { QuickPickItem } from "../../../common/quickPickItem.ts";

import { QuickPickElement } from "./quickPickElement.ts";

function makePicker(labels: string[], canPickMany = false): QuickPickElement {
    const picker = new QuickPickElement();
    picker.preferredWidth = 30;
    picker.canPickMany = canPickMany;
    picker.items = labels.map((label): QuickPickItem => ({ label }));
    picker.layout(BoxConstraints.tight(new Size(30, picker.getMinIntrinsicHeight(30))));
    return picker;
}

function findList(element: TUIElement): ListViewElement | undefined {
    if (element instanceof ListViewElement) return element;
    for (const child of element.getChildren()) {
        const found = findList(child);
        if (found !== undefined) return found;
    }
    return undefined;
}

describe("QuickPickElement.stepActive", () => {
    it("a single-select tells the owner about the step", () => {
        const picker = makePicker(["a", "b"]);
        const active = vi.fn();
        picker.onActiveItemChanged = active;
        picker.stepActive(true);
        expect(picker.selectedIndex).toBe(1);
        expect(active).toHaveBeenCalledOnce();
    });

    it("a one-row list stays put and says nothing", () => {
        const picker = makePicker(["a"]);
        const active = vi.fn();
        picker.onActiveItemChanged = active;
        picker.stepActive(true);
        expect(picker.selectedIndex).toBe(0);
        expect(active).not.toHaveBeenCalled();
    });

    it("a multi-select does not wrap, in either direction", () => {
        const picker = makePicker(["a", "b", "c"], true);
        picker.setActiveIndex(2);
        picker.stepActive(true);
        expect(picker.selectedIndex).toBe(2);
        picker.stepActive(false);
        expect(picker.selectedIndex).toBe(1);
        picker.setActiveIndex(0);
        picker.stepActive(false);
        expect(picker.selectedIndex).toBe(0);
    });

    it("a single-select with its highlight cleared lands on the list edge", () => {
        const picker = makePicker(["a", "b", "c"]);
        picker.clearActive();
        picker.stepActive(false);
        expect(picker.selectedIndex).toBe(2);
    });
});

describe("QuickPickElement — no active row of a multi-select", () => {
    it("the list shows no cursor on open", () => {
        const picker = makePicker(["a", "b"], true);
        expect(picker.selectedIndex).toBe(-1);
        expect(findList(picker)?.isCursorCleared).toBe(true);
    });

    it("the reset gives a multi-select with no active row its first row", () => {
        const picker = makePicker(["a", "b"], true);
        picker.resetFlavorState();
        expect(picker.selectedIndex).toBe(0);
    });

    it("the reset keeps a multi-select's active row", () => {
        const picker = makePicker(["a", "b", "c"], true);
        picker.setActiveIndex(2);
        picker.resetFlavorState();
        expect(picker.selectedIndex).toBe(2);
    });

    it("the reset keeps a single-select's cleared highlight: that state is the owner's", () => {
        const picker = makePicker(["a", "b"]);
        picker.clearActive();
        picker.resetFlavorState();
        expect(picker.selectedIndex).toBe(-1);
    });
});
