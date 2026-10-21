import { describe, expect, it } from "vitest";

import { parseWireQuickPickDispose, parseWireQuickPickUpdate } from "./hostWireParsers.ts";

describe("parseWireQuickPickUpdate", () => {
    it("the diff has only the sent fields; null means reset", () => {
        expect(parseWireQuickPickUpdate({ handle: 3, title: null, canSelectMany: true, value: "" })).toEqual({
            handle: 3,
            title: null,
            canSelectMany: true,
            value: "",
        });
    });

    it("all fields come through intact", () => {
        const full = {
            handle: 3,
            visible: false,
            title: "T",
            step: 1,
            totalSteps: 2,
            placeholder: "p",
            prompt: "pr",
            value: "v",
            canSelectMany: true,
            matchOnDescription: false,
            matchOnDetail: true,
            keepScrollPosition: true,
            items: [{ handle: 4, label: "L", description: "D", detail: "De", alwaysShow: true }],
            activeItems: [0, 4],
            selectedItems: [],
        };
        expect(parseWireQuickPickUpdate(full)).toEqual(full);
    });

    it("a field of the wrong type means untouched, not a rejection of the whole diff", () => {
        expect(
            parseWireQuickPickUpdate({
                handle: 3,
                title: 5,
                step: "two",
                visible: "yes",
                value: null,
                activeItems: "no",
                selectedItems: [1, -1, 1.5],
                items: "no",
            }),
        ).toEqual({ handle: 3, selectedItems: [1] });
        expect(parseWireQuickPickUpdate({ handle: 3, step: null, totalSteps: Number.NaN })).toEqual({
            handle: 3,
            step: null,
        });
    });

    it("an item without handle is dropped, one without a label stays with an empty one", () => {
        expect(
            parseWireQuickPickUpdate({
                handle: 3,
                items: [null, 5, { label: "no handle" }, { handle: 1.5, label: "fractional" }, { handle: 2, label: 7 }],
            }),
        ).toEqual({
            handle: 3,
            items: [{ handle: 2, label: "", description: undefined, detail: undefined, alwaysShow: false }],
        });
    });

    it("no handle or not an object → null", () => {
        expect(parseWireQuickPickUpdate(null)).toBeNull();
        expect(parseWireQuickPickUpdate("x")).toBeNull();
        expect(parseWireQuickPickUpdate({ title: "T" })).toBeNull();
    });
});

describe("parseWireQuickPickDispose", () => {
    it("handle or null", () => {
        expect(parseWireQuickPickDispose({ handle: 3 })).toBe(3);
        expect(parseWireQuickPickDispose({})).toBeNull();
        expect(parseWireQuickPickDispose(null)).toBeNull();
    });
});
