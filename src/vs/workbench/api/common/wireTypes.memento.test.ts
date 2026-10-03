import { describe, expect, it } from "vitest";

import { parseWireMementoUpdate, parseWireMementoValue } from "./wireTypes.ts";

describe("wireTypes — memento", () => {
    it("parseWireMementoUpdate принимает id, scope и словарь", () => {
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
        ["не объект", "x"],
        ["null", null],
        ["пустой id", { extensionId: "", shared: true, value: {} }],
        ["id не строка", { extensionId: 1, shared: true, value: {} }],
        ["shared не boolean", { extensionId: "a.b", shared: "yes", value: {} }],
        ["value не объект", { extensionId: "a.b", shared: true, value: "v" }],
        ["value null", { extensionId: "a.b", shared: true, value: null }],
        ["value массив", { extensionId: "a.b", shared: true, value: [1] }],
    ])("parseWireMementoUpdate отвергает чужую форму: %s", (_name, raw) => {
        expect(parseWireMementoUpdate(raw)).toBeNull();
    });

    it("parseWireMementoValue: plain-объект как есть, иное — пустой словарь", () => {
        expect(parseWireMementoValue({ a: 1 })).toEqual({ a: 1 });
        expect(parseWireMementoValue(undefined)).toEqual({});
        expect(parseWireMementoValue(null)).toEqual({});
        expect(parseWireMementoValue([1, 2])).toEqual({});
        expect(parseWireMementoValue("x")).toEqual({});
    });
});
