import { describe, expect, it } from "vitest";

import { resetArgs, revertArgs } from "./resetArgs.ts";

const SHA = "a".repeat(40);

describe("resetArgs", () => {
    it("собирает argv для каждого режима", () => {
        expect(resetArgs({ ref: SHA, mode: "soft" })).toEqual(["reset", "--soft", SHA]);
        expect(resetArgs({ ref: SHA, mode: "mixed" })).toEqual(["reset", "--mixed", SHA]);
        expect(resetArgs({ ref: SHA, mode: "hard" })).toEqual(["reset", "--hard", SHA]);
    });

    it("неизвестный режим отбрасывается (значение из-за границы процесса)", () => {
        expect(resetArgs({ ref: SHA, mode: "keep" })).toBeNull();
        expect(resetArgs({ ref: SHA, mode: "--force" })).toBeNull();
        expect(resetArgs({ ref: SHA, mode: 1 })).toBeNull();
        expect(resetArgs({ ref: SHA })).toBeNull();
    });

    it("ref, похожий на флаг, отбрасывается", () => {
        expect(resetArgs({ ref: "--hard", mode: "soft" })).toBeNull();
        expect(resetArgs({ ref: "", mode: "soft" })).toBeNull();
        expect(resetArgs({ mode: "soft" })).toBeNull();
    });
});

describe("revertArgs", () => {
    it("собирает argv с --no-edit", () => {
        expect(revertArgs({ ref: SHA })).toEqual(["revert", "--no-edit", SHA]);
    });

    it("невалидный ref отбрасывается", () => {
        expect(revertArgs({ ref: "-x" })).toBeNull();
        expect(revertArgs({})).toBeNull();
    });
});
