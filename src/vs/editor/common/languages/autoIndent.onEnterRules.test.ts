import { describe, expect, it } from "vitest";

import type { IOnEnterAction } from "../../../platform/extensions/common/iLanguageConfiguration.ts";

import { computeNewLinePlan, findOnEnterAction } from "./autoIndent.ts";
import { resolveLanguageConfiguration } from "./languageConfiguration.ts";

const NONE: IOnEnterAction = { indent: "none" };
const INDENT: IOnEnterAction = { indent: "indent" };

function plan(lineContent: string, enterAction: IOnEnterAction, insertSpaces = true) {
    return computeNewLinePlan({ lineContent, column: lineContent.length, tabSize: 4, insertSpaces, enterAction });
}

describe("findOnEnterAction", () => {
    const rules = resolveLanguageConfiguration({
        onEnterRules: [
            { beforeText: "^a", afterText: "^b", action: NONE },
            { beforeText: "^a", previousLineText: "^p", action: INDENT },
            { beforeText: { pattern: "^G", flags: "gi" }, action: { indent: "outdent" } },
        ],
    }).onEnterRules;

    it("the first rule whose every regex matches wins", () => {
        expect(findOnEnterAction(rules, "p", "a", "b")).toEqual(NONE);
        expect(findOnEnterAction(rules, "p", "a", "x")).toEqual(INDENT);
    });

    it("no rule matches: no action", () => {
        expect(findOnEnterAction(rules, "x", "a", "x")).toBeUndefined();
        expect(findOnEnterAction([], "", "", "")).toBeUndefined();
    });

    it("a g flag carries no state between calls", () => {
        expect(findOnEnterAction(rules, "", "g", "")?.indent).toBe("outdent");
        expect(findOnEnterAction(rules, "", "g", "")?.indent).toBe("outdent");
    });
});

describe("computeNewLinePlan — enter action", () => {
    it("none keeps the indent and appends the text", () => {
        expect(plan("  // x", { indent: "none", appendText: "// " })).toEqual({
            editText: "\n  // ",
            blockExpand: false,
            cursorColumn: 5,
        });
    });

    it("wins over the bracket logic", () => {
        expect(plan("  foo(", NONE).editText).toBe("\n  ");
    });

    it("indent adds one unit before the appended text", () => {
        expect(plan("  x", { indent: "indent", appendText: "* " }).editText).toBe("\n      * ");
        expect(plan("\tx", INDENT, false).editText).toBe("\n\t\t");
    });

    it("indentOutdent makes two lines, the cursor on the inner one; appendText replaces the unit", () => {
        expect(plan("  x", { indent: "indentOutdent" })).toEqual({
            editText: "\n      \n  ",
            blockExpand: true,
            cursorColumn: 6,
        });
        expect(plan("  x", { indent: "indentOutdent", appendText: "-" })).toEqual({
            editText: "\n  -\n  ",
            blockExpand: true,
            cursorColumn: 3,
        });
    });

    it.each([
        ["back to the previous tab stop", "      x", "\n    "],
        ["a whole unit from a tab stop", "        x", "\n    "],
        ["a tab", "\t\tx", "\n\t"],
        ["the last of three tabs", "\t\t\tx", "\n\t\t"],
        ["a tab after spaces", "  \tx", "\n  "],
        ["spaces after a tab, not the tab", "\t  x", "\n\t"],
        ["only the spaces after the last tab", "  \t x", "\n  \t"],
        ["nothing to take", "x", "\n"],
    ])("outdent: %s", (_name, line, expected) => {
        expect(plan(line, { indent: "outdent" }).editText).toBe(expected);
    });

    it("removeText takes characters off the indent, not past its start", () => {
        expect(plan("    x", { indent: "none", removeText: 1 }).editText).toBe("\n   ");
        expect(plan(" x", { indent: "none", removeText: 5 }).editText).toBe("\n");
    });

    it("leading tabs of appendText follow the indent settings", () => {
        expect(plan("x", { indent: "none", appendText: "\t\ty" }).editText).toBe("\n        y");
        expect(plan("x", { indent: "none", appendText: "\ty" }, false).editText).toBe("\n\ty");
        expect(plan("x", { indent: "none", appendText: "y\tz" }).editText).toBe("\ny\tz");
    });
});
