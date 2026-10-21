import { describe, expect, it } from "vitest";

import { parseWireShowMessageRequest } from "./hostWireParsers.ts";

describe("parseWireShowMessageRequest", () => {
    it("parses a full request", () => {
        expect(
            parseWireShowMessageRequest({
                severity: "warn",
                message: "careful",
                detail: "details",
                modal: true,
                items: [{ title: "Delete" }, { title: "Cancel", isCloseAffordance: true }],
            }),
        ).toEqual({
            severity: "warn",
            message: "careful",
            detail: "details",
            modal: true,
            items: [
                { title: "Delete", isCloseAffordance: false },
                { title: "Cancel", isCloseAffordance: true },
            ],
        });
    });

    it("minimal request: no buttons, non-modal, no detail", () => {
        expect(parseWireShowMessageRequest({ severity: "info", message: "hi" })).toEqual({
            severity: "info",
            message: "hi",
            detail: undefined,
            modal: false,
            items: [],
        });
    });

    it("unknown severity reads as info", () => {
        expect(parseWireShowMessageRequest({ severity: "fatal", message: "hi" })?.severity).toBe("info");
    });

    it("error and warn pass as is", () => {
        expect(parseWireShowMessageRequest({ severity: "error", message: "hi" })?.severity).toBe("error");
        expect(parseWireShowMessageRequest({ severity: "warn", message: "hi" })?.severity).toBe("warn");
    });

    it("nothing to show without text → null", () => {
        expect(parseWireShowMessageRequest({ severity: "info" })).toBeNull();
        expect(parseWireShowMessageRequest({ severity: "info", message: 7 })).toBeNull();
    });

    it("non-object → null", () => {
        expect(parseWireShowMessageRequest(null)).toBeNull();
        expect(parseWireShowMessageRequest("hi")).toBeNull();
    });

    it("garbage instead of items: no buttons", () => {
        expect(parseWireShowMessageRequest({ severity: "info", message: "hi", items: "nope" })?.items).toEqual([]);
    });

    it("a garbage button STAYS in the set as empty: the answer is addressed by index into it", () => {
        expect(
            parseWireShowMessageRequest({
                severity: "info",
                message: "hi",
                items: [null, { title: 7 }, { title: "Ok" }],
            })?.items,
        ).toEqual([
            { title: "", isCloseAffordance: false },
            { title: "", isCloseAffordance: false },
            { title: "Ok", isCloseAffordance: false },
        ]);
    });

    it("modal only on strict true", () => {
        expect(parseWireShowMessageRequest({ severity: "info", message: "hi", modal: "yes" })?.modal).toBe(false);
    });

    it("non-string detail is dropped", () => {
        expect(parseWireShowMessageRequest({ severity: "info", message: "hi", detail: 7 })?.detail).toBeUndefined();
    });
});
