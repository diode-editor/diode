import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";

import { FilteredListControl } from "./filteredListControl.ts";

function make(): FilteredListControl {
    return new FilteredListControl({
        viewId: "testView",
        listId: "testList",
        placeholder: "Search Things",
    });
}

function appendRow(control: FilteredListControl, id: string, text: string): void {
    const row = new TextLabelElement(text);
    row.id = id;
    control.list.appendRow(row);
}

describe("FilteredListControl — wiring", () => {
    it("forwards typing in the input through onQueryChange", () => {
        const control = make();
        const queries: string[] = [];
        control.onQueryChange = (query) => queries.push(query);

        control.input.inputState.value = "abc";
        control.input.onChange?.("abc");

        expect(queries).toEqual(["abc"]);
        expect(control.getQuery()).toBe("abc");
    });

    it("setQuery sets the value and passes it through onQueryChange", () => {
        const control = make();
        const queries: string[] = [];
        control.onQueryChange = (query) => queries.push(query);

        control.setQuery("@conflicts");

        expect(control.getQuery()).toBe("@conflicts");
        expect(queries).toEqual(["@conflicts"]);
    });

    it("activating a list row reaches onActivateRow with the row id", () => {
        const control = make();
        const activated: string[] = [];
        control.onActivateRow = (rowId) => activated.push(rowId);
        appendRow(control, "row-1", "First");

        const row = control.view.querySelector("#row-1");
        expect(row).not.toBeNull();
        control.list.onActivate?.(row!);

        expect(activated).toEqual(["row-1"]);
    });

    it("an element without an id cannot be addressed: the handler is not called", () => {
        const control = make();
        const activated: string[] = [];
        control.onActivateRow = (rowId) => activated.push(rowId);
        // Such a row can't be put into the list itself (appendRow requires an id), so
        // test the handler contract directly.
        control.list.onActivate?.(new TextLabelElement("No id"));

        expect(activated).toEqual([]);
    });

    it("stays silent when callbacks are not set: input, activation and setQuery", () => {
        const control = make();
        appendRow(control, "row-1", "First");

        expect(() => {
            control.input.onChange?.("x");
            control.list.onActivate?.(control.view.querySelector("#row-1")!);
            // setQuery without onQueryChange must not throw.
            control.setQuery("y");
        }).not.toThrow();
        expect(control.getQuery()).toBe("y");
    });

    it("focusInput/focusList focus their elements", () => {
        const control = make();
        const inputFocus = vi.spyOn(control.input, "focus").mockImplementation(() => {});
        const listFocus = vi.spyOn(control.list, "focus").mockImplementation(() => {});

        control.focusInput();
        control.focusList();

        expect(inputFocus).toHaveBeenCalledOnce();
        expect(listFocus).toHaveBeenCalledOnce();
    });
});

describe("FilteredListControl — frame", () => {
    it("renders the query placeholder in the header and rows in the body", () => {
        const control = make();
        appendRow(control, "row-1", "First row");
        appendRow(control, "row-2", "Second row");

        const backend = renderElement(control.view, 30, 6, { themeVars: true });
        const screen = backend.screenToString();

        expect(screen).toContain("Search Things");
        expect(screen).toContain("First row");
        expect(screen).toContain("Second row");
        expect(control.view.id).toBe("testView");
        expect(control.list.id).toBe("testList");
    });

    it("showPlaceholderRow yields an empty-state placeholder row", () => {
        const control = make();
        control.showPlaceholderRow("emptyRow", "No things found");

        const backend = renderElement(control.view, 30, 5, { themeVars: true });

        expect(backend.screenToString()).toContain("No things found");
        expect(control.view.querySelector("#emptyRow")).not.toBeNull();
        expect(control.list.rowCount).toBe(1);
    });
});
