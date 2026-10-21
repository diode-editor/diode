import { describe, expect, it } from "vitest";

import { computeIndentationStep } from "./indentationDetector.ts";

// Tested directly: via `detectIndentation` steps 0, 1 and >8 never reach `tabSize`, so there's no way to check them.

function indentOf(line: string): number {
    const match = /^[ \t]*/.exec(line);
    return match![0].length;
}

function step(a: string, b: string): { step: number; looksLikeAlignment: boolean } {
    const result = computeIndentationStep(a, indentOf(a), b, indentOf(b));
    return { step: result.step, looksLikeAlignment: result.looksLikeAlignment };
}

describe("computeIndentationStep — spaces", () => {
    it("the first line's indentation is measured from an empty seed", () => {
        expect(step("", "  a")).toEqual({ step: 2, looksLikeAlignment: false });
    });

    it("same indentation — zero step", () => {
        expect(step("    a", "    b")).toEqual({ step: 0, looksLikeAlignment: false });
    });

    it("indenting by one level", () => {
        expect(step("  a", "    b")).toEqual({ step: 2, looksLikeAlignment: false });
    });

    it("leaving a level yields the same step as entering it", () => {
        expect(step("        a", "    b")).toEqual({ step: 4, looksLikeAlignment: false });
    });

    it("the step is measured by the tail after the common prefix, not by the full width", () => {
        expect(step("    a", "       b")).toEqual({ step: 3, looksLikeAlignment: false });
    });

    it("a step above eight is returned as is — the histogram drops it later", () => {
        expect(step("a", "            b")).toEqual({ step: 12, looksLikeAlignment: false });
    });
});

describe("computeIndentationStep — tabs", () => {
    it("indenting with tabs at an equal space count", () => {
        expect(step("\ta", "\t\tb")).toEqual({ step: 0, looksLikeAlignment: false });
    });

    it("same tab indentation — zero step", () => {
        expect(step("\t\ta", "\t\tb")).toEqual({ step: 0, looksLikeAlignment: false });
    });

    it("tabs vs spaces: tab width = spaces divided by consumed tabs", () => {
        expect(step("\t\ta", "    b")).toEqual({ step: 2, looksLikeAlignment: false });
        expect(step("\ta", "        b")).toEqual({ step: 8, looksLikeAlignment: false });
    });

    it("order does not matter: spaces on the previous line, tabs on the current one", () => {
        expect(step("    a", "\tb")).toEqual({ step: 4, looksLikeAlignment: false });
    });

    it("not evenly divisible — no signal", () => {
        expect(step("\t\ta", "   b")).toEqual({ step: 0, looksLikeAlignment: false });
    });

    it("a common tab prefix is dropped before dividing", () => {
        expect(step("\t\ta", "\t    b")).toEqual({ step: 4, looksLikeAlignment: false });
    });
});

describe("computeIndentationStep — mixed indentation", () => {
    it("the previous line mixes tabs and spaces — no signal", () => {
        expect(step("\t  a", "b")).toEqual({ step: 0, looksLikeAlignment: false });
    });

    it("the current line mixes tabs and spaces — no signal", () => {
        expect(step("a", "\t  b")).toEqual({ step: 0, looksLikeAlignment: false });
    });

    it("a mix in the common prefix does not count as a mix: it is dropped", () => {
        expect(step("\t a", "\t     b")).toEqual({ step: 4, looksLikeAlignment: false });
    });
});

describe("computeIndentationStep — aligned continuation", () => {
    const CONTINUED = "foo(a, b,";
    const ALIGNED = "       c);";

    it("recognizes a continuation aligned under an argument", () => {
        expect(step(CONTINUED, ALIGNED)).toEqual({ step: 7, looksLikeAlignment: true });
    });

    it("the previous line does not end with a comma — regular indentation", () => {
        expect(step("foo(a, b;", ALIGNED)).toEqual({ step: 7, looksLikeAlignment: false });
    });

    it("a non-space on the previous line under the continuation's first character — regular indentation", () => {
        expect(step(CONTINUED, "        c);")).toEqual({ step: 8, looksLikeAlignment: false });
    });

    it("the continuation itself has a space at that position — regular indentation", () => {
        // The character at position `bSpaces` is a space, so it's still indentation, not text.
        expect(step("    foo(a, b,", "     c);")).toEqual({ step: 1, looksLikeAlignment: false });
    });

    it("a zero step does not count as alignment", () => {
        expect(step("foo(a, b,", "foo(c, d,")).toEqual({ step: 0, looksLikeAlignment: false });
    });

    it("alignment is checked only at an equal tab count", () => {
        // Tab counts differ → the division branch, which has no alignment flag.
        expect(step("\tfoo(a, b,", ALIGNED)).toEqual({ step: 7, looksLikeAlignment: false });
    });
});
