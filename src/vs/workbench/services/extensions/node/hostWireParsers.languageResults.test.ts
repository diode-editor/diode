import { describe, expect, it } from "vitest";

import { wireToCoreRenameLocation } from "./hostWireParsers.ts";

describe("hostWireParsers — wireToCoreRenameLocation", () => {
    it("имя символа доезжает placeholder'ом", () => {
        expect(wireToCoreRenameLocation({ placeholder: "value" })).toEqual({ kind: "name", name: "value" });
    });

    it("отказ бьёт имя: провайдер, сказавший «здесь нельзя», поля ввода не открывает", () => {
        expect(wireToCoreRenameLocation({ rejectReason: "nope" })).toEqual({ kind: "reject", reason: "nope" });
        expect(wireToCoreRenameLocation({ placeholder: "value", rejectReason: "nope" })).toEqual({
            kind: "reject",
            reason: "nope",
        });
    });

    it("ни имени, ни причины — null (ядро спросит следующего провайдера)", () => {
        expect(wireToCoreRenameLocation({})).toBeNull();
    });
});
