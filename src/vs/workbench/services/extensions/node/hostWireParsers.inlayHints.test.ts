import { describe, expect, it } from "vitest";

import { wireToCoreInlayHints } from "./hostWireParsers.ts";

const AT = { line: 2, character: 3 };

describe("wireToCoreInlayHints", () => {
    it("a string label stays; a part's value becomes the core's label; kind and paddings are carried", () => {
        expect(
            wireToCoreInlayHints([
                { position: AT, label: ": number", kind: 1, paddingLeft: true },
                { position: AT, label: [{ value: "a" }, { value: "b" }], kind: 2, paddingRight: true },
                { position: AT, label: "plain" },
            ]),
        ).toStrictEqual([
            { position: AT, label: ": number", kind: 1, paddingLeft: true },
            { position: AT, label: [{ label: "a" }, { label: "b" }], kind: 2, paddingRight: true },
            { position: AT, label: "plain" },
        ]);
    });

    it("a broken position, an unknown kind or a broken label costs only that hint", () => {
        expect(
            wireToCoreInlayHints([
                { position: { line: Number.NaN, character: 0 }, label: "x" },
                { position: { line: 0, character: "1" }, label: "x" },
                { position: { line: 0 }, label: "x" },
                { label: "x" },
                { position: AT, label: "x", kind: 0 },
                { position: AT, label: "x", kind: 3 },
                { position: AT, label: "x", kind: "1" },
                { position: AT, label: "x", kind: null },
                { position: AT, label: 7 },
                { position: AT },
                { position: AT, label: [{ value: 1 }] },
                { position: AT, label: [null] },
                null,
                7,
                { position: AT, label: "kept" },
            ]),
        ).toStrictEqual([{ position: AT, label: "kept" }]);
    });

    it("only true is a padding", () => {
        expect(wireToCoreInlayHints([{ position: AT, label: "x", paddingLeft: 1, paddingRight: "yes" }])).toStrictEqual(
            [{ position: AT, label: "x" }],
        );
    });
});
