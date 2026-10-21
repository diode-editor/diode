import { describe, expect, it } from "vitest";

import { resetArgs, revertArgs } from "./resetArgs.ts";

const SHA = "a".repeat(40);

describe("resetArgs", () => {
    it("builds argv for each mode", () => {
        expect(resetArgs({ ref: SHA, mode: "soft" })).toEqual(["reset", "--soft", SHA]);
        expect(resetArgs({ ref: SHA, mode: "mixed" })).toEqual(["reset", "--mixed", SHA]);
        expect(resetArgs({ ref: SHA, mode: "hard" })).toEqual(["reset", "--hard", SHA]);
    });

    it("drops an unknown mode (value from across the process boundary)", () => {
        expect(resetArgs({ ref: SHA, mode: "keep" })).toBeNull();
        expect(resetArgs({ ref: SHA, mode: "--force" })).toBeNull();
        expect(resetArgs({ ref: SHA, mode: 1 })).toBeNull();
        expect(resetArgs({ ref: SHA })).toBeNull();
    });

    it("drops a flag-like ref", () => {
        expect(resetArgs({ ref: "--hard", mode: "soft" })).toBeNull();
        expect(resetArgs({ ref: "", mode: "soft" })).toBeNull();
        expect(resetArgs({ mode: "soft" })).toBeNull();
    });
});

describe("revertArgs", () => {
    it("builds argv with --no-edit", () => {
        expect(revertArgs({ ref: SHA })).toEqual(["revert", "--no-edit", SHA]);
    });

    it("drops an invalid ref", () => {
        expect(revertArgs({ ref: "-x" })).toBeNull();
        expect(revertArgs({})).toBeNull();
    });
});
