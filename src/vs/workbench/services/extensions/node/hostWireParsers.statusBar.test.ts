import { describe, expect, it } from "vitest";

import { parseWireStatusBarItem, parseWireStatusBarItemDispose } from "./hostWireParsers.ts";

describe("parseWireStatusBarItem", () => {
    const valid = { handle: 1, id: "demo", alignment: "left", text: "Demo" };

    it("parses a minimal envelope", () => {
        expect(parseWireStatusBarItem(valid)).toEqual(valid);
    });

    it("parses a full envelope", () => {
        expect(
            parseWireStatusBarItem({
                ...valid,
                alignment: "right",
                priority: 100,
                name: "Status Bar Demo",
                command: "demo.click",
                arguments: [1, "two"],
            }),
        ).toEqual({
            handle: 1,
            id: "demo",
            alignment: "right",
            text: "Demo",
            priority: 100,
            name: "Status Bar Demo",
            command: "demo.click",
            arguments: [1, "two"],
        });
    });

    it("empty text is a valid item state", () => {
        expect(parseWireStatusBarItem({ ...valid, text: "" })?.text).toBe("");
    });

    it.each([
        ["not an object", "nope"],
        // A function is the only non-object value with fields: without `typeof raw === "object"` it would slip through.
        ["function with the required fields", Object.assign(() => undefined, valid)],
        ["null", null],
        ["no handle", { ...valid, handle: undefined }],
        ["non-numeric handle", { ...valid, handle: "1" }],
        ["infinite handle", { ...valid, handle: Number.POSITIVE_INFINITY }],
        ["no id", { ...valid, id: undefined }],
        ["empty id", { ...valid, id: "" }],
        ["foreign alignment", { ...valid, alignment: "top" }],
        ["no text", { ...valid, text: undefined }],
    ])("rejects the envelope: %s", (_name, raw) => {
        expect(parseWireStatusBarItem(raw)).toBeNull();
    });

    it.each([
        ["non-numeric priority", { priority: "100" }],
        ["NaN priority", { priority: Number.NaN }],
    ])("drops a single field: %s", (_name, patch) => {
        expect(parseWireStatusBarItem({ ...valid, ...patch })?.priority).toBeUndefined();
    });

    it("an empty name is not a name (otherwise the visibility menu would get a nameless entry)", () => {
        expect(parseWireStatusBarItem({ ...valid, name: "" })?.name).toBeUndefined();
    });

    it("an empty command is not a command", () => {
        expect(parseWireStatusBarItem({ ...valid, command: "" })?.command).toBeUndefined();
    });

    it("non-string name and command are dropped", () => {
        const parsed = parseWireStatusBarItem({ ...valid, name: 7, command: 7 });

        expect(parsed?.name).toBeUndefined();
        expect(parsed?.command).toBeUndefined();
    });

    it("a non-array in arguments is dropped", () => {
        expect(parseWireStatusBarItem({ ...valid, command: "c", arguments: "x" })?.arguments).toBeUndefined();
    });
});

describe("parseWireStatusBarItemDispose", () => {
    it("parses the handle", () => {
        expect(parseWireStatusBarItemDispose({ handle: 3 })).toEqual({ handle: 3 });
    });

    it.each([
        ["not an object", 3],
        ["function with the required fields", Object.assign(() => undefined, { handle: 3 })],
        ["null", null],
        ["non-numeric handle", { handle: "3" }],
    ])("rejects the envelope: %s", (_name, raw) => {
        expect(parseWireStatusBarItemDispose(raw)).toBeNull();
    });
});
