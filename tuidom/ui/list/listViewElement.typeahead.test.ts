import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TestApp } from "../../testing/TestApp.ts";
import { Size } from "../../common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { TextLabelElement } from "../text/textLabelElement.ts";

import { ListViewElement } from "./listViewElement.ts";

function makeRow(id: string): TextLabelElement {
    const row = new TextLabelElement(id);
    row.id = id;
    return row;
}

function key(list: ListViewElement, name: string, mods: { ctrlKey?: boolean; altKey?: boolean } = {}): void {
    list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: name, ctrlKey: mods.ctrlKey, altKey: mods.altKey }));
}

function createList(labels: (string | undefined)[]): ListViewElement {
    const list = new ListViewElement();
    labels.forEach((label, i) => {
        list.appendRow(makeRow(`r${i}`), label !== undefined ? { label } : undefined);
    });
    TestApp.createWithContent(list, new Size(30, 10));
    list.focus();
    return list;
}

function cursorId(list: ListViewElement): unknown {
    return list.inspectState().cursorId;
}

describe("ListViewElement typeahead", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("jumps to the first row whose label starts with the typed char", () => {
        const list = createList(["alpha", "beta", "gamma"]);
        key(list, "g");
        expect(cursorId(list)).toBe("r2");
    });

    it("is case-insensitive", () => {
        const list = createList(["Alpha", "Beta"]);
        key(list, "B");
        expect(cursorId(list)).toBe("r1");
    });

    it("refines the prefix with further keys", () => {
        const list = createList(["bar", "baz", "qux"]);
        key(list, "b");
        expect(cursorId(list)).toBe("r0");
        key(list, "a");
        key(list, "z");
        expect(cursorId(list)).toBe("r1");
    });

    it("repeating the same char cycles through matches and wraps", () => {
        const list = createList(["apple", "avocado", "banana", "apricot"]);
        key(list, "a");
        expect(cursorId(list)).toBe("r0");
        key(list, "a");
        expect(cursorId(list)).toBe("r1");
        key(list, "a");
        expect(cursorId(list)).toBe("r3");
        key(list, "a");
        expect(cursorId(list)).toBe("r0");
    });

    it("resets the buffer after the timeout", () => {
        const list = createList(["sun", "moon", "star"]);
        key(list, "s");
        expect(cursorId(list)).toBe("r0");
        vi.advanceTimersByTime(1000);
        key(list, "m");
        expect(cursorId(list)).toBe("r1");
    });

    it("skips rows without a label", () => {
        const list = createList([undefined, "match"]);
        key(list, "m");
        expect(cursorId(list)).toBe("r1");
    });

    it("no match leaves the cursor unchanged", () => {
        const list = createList(["alpha", "beta"]);
        key(list, "z");
        expect(cursorId(list)).toBe("r0");
    });

    it("ignores modifiers and non-printable keys", () => {
        const list = createList(["alpha", "beta"]);
        key(list, "b", { ctrlKey: true });
        key(list, "b", { altKey: true });
        key(list, "F1");
        expect(cursorId(list)).toBe("r0");
    });

    it("is disabled entirely by the constructor option", () => {
        const list = new ListViewElement({ typeahead: false });
        for (const label of ["alpha", "beta"]) {
            const row = makeRow(`r-${label}`);
            list.appendRow(row, { label });
        }
        TestApp.createWithContent(list, new Size(30, 10));
        list.focus();

        key(list, "b");
        expect(list.inspectState()).toMatchObject({ cursorId: "r-alpha" });
    });

    it("does nothing on an empty list", () => {
        const list = createList([]);
        key(list, "a");
        expect(cursorId(list)).toBeNull();
    });
});
