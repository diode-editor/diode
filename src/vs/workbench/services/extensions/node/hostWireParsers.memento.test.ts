import { describe, expect, it } from "vitest";

import { parseWireMementoUpdate } from "./hostWireParsers.ts";

describe("hostWireParsers — memento", () => {
    it("parseWireMementoUpdate accepts id, scope and a dictionary", () => {
        expect(parseWireMementoUpdate({ extensionId: "a.b", shared: true, value: { k: 1 } })).toEqual({
            extensionId: "a.b",
            shared: true,
            value: { k: 1 },
        });
        expect(parseWireMementoUpdate({ extensionId: "a.b", shared: false, value: {} })).toEqual({
            extensionId: "a.b",
            shared: false,
            value: {},
        });
    });

    it.each([
        ["not an object", "x"],
        ["null", null],
        ["empty id", { extensionId: "", shared: true, value: {} }],
        ["id not a string", { extensionId: 1, shared: true, value: {} }],
        ["shared not a boolean", { extensionId: "a.b", shared: "yes", value: {} }],
        ["value not an object", { extensionId: "a.b", shared: true, value: "v" }],
        ["value null", { extensionId: "a.b", shared: true, value: null }],
        ["value is an array", { extensionId: "a.b", shared: true, value: [1] }],
    ])("parseWireMementoUpdate rejects a foreign shape: %s", (_name, raw) => {
        expect(parseWireMementoUpdate(raw)).toBeNull();
    });
});
