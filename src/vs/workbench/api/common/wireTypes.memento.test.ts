import { describe, expect, it } from "vitest";

import { parseWireMementoValue } from "./wireTypes.ts";

describe("wireTypes — memento", () => {
    it("parseWireMementoValue: plain-объект как есть, иное — пустой словарь", () => {
        expect(parseWireMementoValue({ a: 1 })).toEqual({ a: 1 });
        expect(parseWireMementoValue(undefined)).toEqual({});
        expect(parseWireMementoValue(null)).toEqual({});
        expect(parseWireMementoValue([1, 2])).toEqual({});
        expect(parseWireMementoValue("x")).toEqual({});
    });
});
