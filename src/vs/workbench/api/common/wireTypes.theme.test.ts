import { describe, expect, it } from "vitest";

import { parseWireColorTheme, parseWireSelectionChangeKind, selectionChangeKindOf } from "./wireTypes.ts";

describe("parseWireColorTheme", () => {
    it("принимает все четыре вида темы", () => {
        expect(parseWireColorTheme({ kind: 1 })).toEqual({ kind: 1 });
        expect(parseWireColorTheme({ kind: 2 })).toEqual({ kind: 2 });
        expect(parseWireColorTheme({ kind: 3 })).toEqual({ kind: 3 });
        expect(parseWireColorTheme({ kind: 4 })).toEqual({ kind: 4 });
    });

    it("отбивает вид вне диапазона, чужой тип и не-объект", () => {
        expect(parseWireColorTheme({ kind: 0 })).toBeNull();
        expect(parseWireColorTheme({ kind: 5 })).toBeNull();
        expect(parseWireColorTheme({ kind: "2" })).toBeNull();
        expect(parseWireColorTheme({})).toBeNull();
        expect(parseWireColorTheme(null)).toBeNull();
        expect(parseWireColorTheme(2)).toBeNull();
    });

    it("лишние поля не проносятся дальше — в проводе только kind", () => {
        expect(parseWireColorTheme({ kind: 1, name: "Light+" })).toEqual({ kind: 1 });
    });
});

describe("selectionChangeKindOf / parseWireSelectionChangeKind", () => {
    it("источник ядра → число vscode.TextEditorSelectionChangeKind", () => {
        expect(selectionChangeKindOf("keyboard")).toBe(1);
        expect(selectionChangeKindOf("mouse")).toBe(2);
        expect(selectionChangeKindOf("command")).toBe(3);
    });

    it("нераспознанный источник → undefined (поле в провод не едет)", () => {
        expect(selectionChangeKindOf(undefined)).toBeUndefined();
    });

    it("round-trip: что уехало источником, то и приехало видом", () => {
        for (const source of ["keyboard", "mouse", "command"] as const) {
            expect(parseWireSelectionChangeKind(selectionChangeKindOf(source))).toBe(selectionChangeKindOf(source));
        }
    });

    it("мусор в проводе читается как «источник не распознан»", () => {
        expect(parseWireSelectionChangeKind(0)).toBeUndefined();
        expect(parseWireSelectionChangeKind(4)).toBeUndefined();
        expect(parseWireSelectionChangeKind("2")).toBeUndefined();
        expect(parseWireSelectionChangeKind(undefined)).toBeUndefined();
        expect(parseWireSelectionChangeKind(null)).toBeUndefined();
    });
});
