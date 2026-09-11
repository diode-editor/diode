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

describe("FilteredListControl — проводка", () => {
    it("прокидывает набор в input через onQueryChange", () => {
        const control = make();
        const queries: string[] = [];
        control.onQueryChange = (query) => queries.push(query);

        control.input.inputState.value = "abc";
        control.input.onChange?.("abc");

        expect(queries).toEqual(["abc"]);
        expect(control.getQuery()).toBe("abc");
    });

    it("setQuery ставит значение и прогоняет его через onQueryChange", () => {
        const control = make();
        const queries: string[] = [];
        control.onQueryChange = (query) => queries.push(query);

        control.setQuery("@conflicts");

        expect(control.getQuery()).toBe("@conflicts");
        expect(queries).toEqual(["@conflicts"]);
    });

    it("активация строки списка доходит до onActivateRow с id строки", () => {
        const control = make();
        const activated: string[] = [];
        control.onActivateRow = (rowId) => activated.push(rowId);
        appendRow(control, "row-1", "First");

        const row = control.view.querySelector("#row-1");
        expect(row).not.toBeNull();
        control.list.onActivate?.(row!);

        expect(activated).toEqual(["row-1"]);
    });

    it("молчит, когда колбэки не назначены", () => {
        const control = make();
        appendRow(control, "row-1", "First");

        expect(() => {
            control.input.onChange?.("x");
            control.list.onActivate?.(control.view.querySelector("#row-1")!);
        }).not.toThrow();
    });

    it("focusInput/focusList фокусируют свои элементы", () => {
        const control = make();
        const inputFocus = vi.spyOn(control.input, "focus").mockImplementation(() => {});
        const listFocus = vi.spyOn(control.list, "focus").mockImplementation(() => {});

        control.focusInput();
        control.focusList();

        expect(inputFocus).toHaveBeenCalledOnce();
        expect(listFocus).toHaveBeenCalledOnce();
    });
});

describe("FilteredListControl — кадр", () => {
    it("рисует плейсхолдер запроса в шапке и строки в теле", () => {
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

    it("showPlaceholderRow даёт строку-заглушку пустого состояния", () => {
        const control = make();
        control.showPlaceholderRow("emptyRow", "No things found");

        const backend = renderElement(control.view, 30, 5, { themeVars: true });

        expect(backend.screenToString()).toContain("No things found");
        expect(control.view.querySelector("#emptyRow")).not.toBeNull();
        expect(control.list.rowCount).toBe(1);
    });
});
