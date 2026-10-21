import { describe, expect, it } from "vitest";

import { parseWireMementoValue } from "./wireTypes.ts";

describe("wireTypes — memento", () => {
    it("parseWireMementoValue: plain object as is, anything else yields an empty record", () => {
        expect(parseWireMementoValue({ a: 1 })).toEqual({ a: 1 });
        expect(parseWireMementoValue(undefined)).toEqual({});
        expect(parseWireMementoValue(null)).toEqual({});
        expect(parseWireMementoValue([1, 2])).toEqual({});
        expect(parseWireMementoValue("x")).toEqual({});
    });
});
