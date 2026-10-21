import { describe, expect, it } from "vitest";

import { wireToCoreRenameLocation } from "./hostWireParsers.ts";

describe("hostWireParsers — wireToCoreRenameLocation", () => {
    it("the symbol name comes through as placeholder", () => {
        expect(wireToCoreRenameLocation({ placeholder: "value" })).toEqual({ kind: "name", name: "value" });
    });

    it("rejection beats the name: a provider that says `not here` does not open the input box", () => {
        expect(wireToCoreRenameLocation({ rejectReason: "nope" })).toEqual({ kind: "reject", reason: "nope" });
        expect(wireToCoreRenameLocation({ placeholder: "value", rejectReason: "nope" })).toEqual({
            kind: "reject",
            reason: "nope",
        });
    });

    it("neither name nor reason → null (core asks the next provider)", () => {
        expect(wireToCoreRenameLocation({})).toBeNull();
    });
});
