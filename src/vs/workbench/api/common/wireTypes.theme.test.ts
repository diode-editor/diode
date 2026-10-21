import { describe, expect, it } from "vitest";

import { parseWireColorTheme, parseWireSelectionChangeKind, selectionChangeKindOf } from "./wireTypes.ts";

describe("parseWireColorTheme", () => {
    it("accepts all four theme kinds", () => {
        expect(parseWireColorTheme({ kind: 1 })).toEqual({ kind: 1 });
        expect(parseWireColorTheme({ kind: 2 })).toEqual({ kind: 2 });
        expect(parseWireColorTheme({ kind: 3 })).toEqual({ kind: 3 });
        expect(parseWireColorTheme({ kind: 4 })).toEqual({ kind: 4 });
    });

    it("rejects an out-of-range kind, a foreign type and a non-object", () => {
        expect(parseWireColorTheme({ kind: 0 })).toBeNull();
        expect(parseWireColorTheme({ kind: 5 })).toBeNull();
        expect(parseWireColorTheme({ kind: "2" })).toBeNull();
        expect(parseWireColorTheme({})).toBeNull();
        expect(parseWireColorTheme(null)).toBeNull();
        expect(parseWireColorTheme(2)).toBeNull();
    });

    it("a notification with no params at all gives null, not TypeError", () => {
        // `rpc.notify("window.themeChanged")` without params hands the handler
        // `undefined`, and parsing must survive that without dereferencing it.
        expect(parseWireColorTheme(undefined)).toBeNull();
    });

    it("extra fields are not carried further, only kind is on the wire", () => {
        expect(parseWireColorTheme({ kind: 1, name: "Light+" })).toEqual({ kind: 1 });
    });
});

describe("selectionChangeKindOf / parseWireSelectionChangeKind", () => {
    it("a core source maps to a vscode.TextEditorSelectionChangeKind number", () => {
        expect(selectionChangeKindOf("keyboard")).toBe(1);
        expect(selectionChangeKindOf("mouse")).toBe(2);
        expect(selectionChangeKindOf("command")).toBe(3);
    });

    it("an unrecognized source maps to undefined (the field is not sent)", () => {
        expect(selectionChangeKindOf(undefined)).toBeUndefined();
    });

    it("round-trip: what was sent as a source comes back as a kind", () => {
        for (const source of ["keyboard", "mouse", "command"] as const) {
            expect(parseWireSelectionChangeKind(selectionChangeKindOf(source))).toBe(selectionChangeKindOf(source));
        }
    });

    it("garbage on the wire reads as an unrecognized source", () => {
        expect(parseWireSelectionChangeKind(0)).toBeUndefined();
        expect(parseWireSelectionChangeKind(4)).toBeUndefined();
        expect(parseWireSelectionChangeKind("2")).toBeUndefined();
        expect(parseWireSelectionChangeKind(undefined)).toBeUndefined();
        expect(parseWireSelectionChangeKind(null)).toBeUndefined();
    });
});
