import { describe, expect, it } from "vitest";

import { HoverElement } from "./hoverElement.ts";

function linesOf(block: string, width: number): readonly string[] {
    const element = new HoverElement();
    element.setBlocks([block]);
    return element.linesFor(width);
}

describe("HoverElement — wrapping keeps the indent of code", () => {
    it("an indented line keeps its indent, and its continuation lines get it too, within the width", () => {
        expect(linesOf(".p-4 {\n    padding: calc(var(--spacing) * 4);\n}", 20)).toEqual([
            ".p-4 {",
            "    padding:",
            "    calc(var(--spaci",
            "    ng) * 4);",
            "}",
        ]);
    });

    it("an indent as wide as the popup or wider wraps the line as plain text instead of dropping it", () => {
        expect(linesOf("    ab", 4)).toEqual(["ab"]);
        expect(linesOf("      ab", 4)).toEqual(["ab"]);
        expect(linesOf("   ab", 4)).toEqual(["   a", "   b"]);
    });
});
