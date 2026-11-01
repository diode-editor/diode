import { describe, expect, it } from "vitest";

import type { IWireCodeLens } from "../../../api/common/wireTypes.ts";

import { parseWireCodeLens, parseWireCodeLensList } from "./hostWireParsers.ts";

const RANGE = { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } };

describe("parseWireCodeLens", () => {
    it("takes the address, the range and the command", () => {
        expect(
            parseWireCodeLens({
                cacheId: [3, 1],
                range: RANGE,
                command: { id: "run", title: "Run", tooltip: "Runs" },
            }),
        ).toEqual({ cacheId: [3, 1], range: RANGE, command: { id: "run", title: "Run", tooltip: "Runs" } });
    });

    it("no command: a lens that waits for a resolve; a broken command is the same", () => {
        const expected = { cacheId: [3, 1], range: RANGE };
        expect(parseWireCodeLens({ cacheId: [3, 1], range: RANGE })).toEqual(expected);
        expect(parseWireCodeLens({ cacheId: [3, 1], range: RANGE, command: { id: 1, title: "t" } })).toEqual(expected);
        expect(parseWireCodeLens({ cacheId: [3, 1], range: RANGE, command: { id: "x" } })).toEqual(expected);
    });

    it("a tooltip that is not a string is left out", () => {
        expect(
            parseWireCodeLens({ cacheId: [3, 1], range: RANGE, command: { id: "x", title: "t", tooltip: 1 } })?.command,
        ).toEqual({ id: "x", title: "t" });
    });

    it.each([
        ["nothing", null],
        ["no address", { range: RANGE }],
        ["an address that is not a pair", { cacheId: [1], range: RANGE }],
        ["a longer address", { cacheId: [1, 2, 3], range: RANGE }],
        ["an address of strings", { cacheId: ["1", "2"], range: RANGE }],
        ["an address that is not an array", { cacheId: 1, range: RANGE }],
        ["no range", { cacheId: [1, 2] }],
    ])("%s is null", (_name, raw) => {
        expect(parseWireCodeLens(raw)).toBeNull();
    });
});

describe("parseWireCodeLensList", () => {
    it("a broken lens is dropped, not the whole answer", () => {
        const good: IWireCodeLens = { cacheId: [3, 0], range: RANGE };
        expect(parseWireCodeLensList({ cacheId: 3, lenses: [good, { range: RANGE } as IWireCodeLens] })).toEqual({
            cacheId: 3,
            lenses: [good],
        });
    });
});
