import { describe, expect, it } from "vitest";

import type { IOnEnterAction } from "../../../platform/extensions/common/iLanguageConfiguration.ts";
import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";
import { EditorViewState } from "../viewModel/editorViewState.ts";

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
    });
});

describe("EditorViewState.insertNewLine — onEnterRules", () => {
    function state(text: string, selection = createCursorSelection(1, 1)) {
        return new EditorViewState(new TextDocument(text), [selection]);
    }

    it("the rule sees the previous line, the text before the cursor and the text after it", () => {
        const rules = resolveLanguageConfiguration({
            onEnterRules: [
                {
                    beforeText: "^b$",
                    afterText: "^c$",
                    previousLineText: "^a$",
                    action: { indent: "none", appendText: "!" },
                },
            ],
        }).onEnterRules;
        const view = state("a\nbc");
        view.insertNewLine(rules);
        expect(view.document.getText()).toBe("a\nb\n!c");
    });

    it("the text after a multiline selection comes from its last line; the first line has no previous one", () => {
        const rules = resolveLanguageConfiguration({
            onEnterRules: [
                {
                    beforeText: "^a$",
                    afterText: "^z$",
                    previousLineText: "^$",
                    action: { indent: "none", appendText: "!" },
                },
            ],
        }).onEnterRules;
        const view = state("ab\nyz", createSelection(0, 1, 1, 1));
        view.insertNewLine(rules);
        expect(view.document.getText()).toBe("a\n!z");
    });

    it("the cursor lands after the appended text", () => {
        const rules = resolveLanguageConfiguration({
            onEnterRules: [{ beforeText: "^//", action: { indent: "none", appendText: "// " } }],
        }).onEnterRules;
        const view = state("// a", createCursorSelection(0, 4));
        view.insertNewLine(rules);
        expect(view.selections[0].active).toEqual({ line: 1, character: 3 });
    });
});

describe("resolveLanguageConfiguration — onEnterRules", () => {
    it("takes a string or a pattern with flags", () => {
        const [first, second] = resolveLanguageConfiguration({
            onEnterRules: [
                { beforeText: "a", action: NONE },
                { beforeText: { pattern: "b", flags: "i" }, afterText: "c", previousLineText: "d", action: INDENT },
            ],
        }).onEnterRules;
        expect(first).toEqual({ beforeText: /a/, afterText: undefined, previousLineText: undefined, action: NONE });
        expect(second).toEqual({ beforeText: /b/i, afterText: /c/, previousLineText: /d/, action: INDENT });
    });

    it("drops a rule with a broken beforeText, action or indent, and only that rule", () => {
        const rules = resolveLanguageConfiguration({
            onEnterRules: [
                null,
                "rule",
                { beforeText: "(", action: NONE },
                { action: NONE },
                { beforeText: "a" },
                { beforeText: "a", action: null },
                { beforeText: "a", action: { indent: "sideways" } },
                { beforeText: "good", action: NONE },
            ],
        } as never).onEnterRules;
        expect(rules.map((rule) => rule.beforeText.source)).toEqual(["good"]);
    });

    it("a broken optional regex is dropped on its own, junk action fields too", () => {
        const [rule] = resolveLanguageConfiguration({
            onEnterRules: [
                {
                    beforeText: "a",
                    afterText: "(",
                    previousLineText: "[",
                    action: { indent: "none", appendText: 1, removeText: "x" },
                },
            ],
        } as never).onEnterRules;
        expect(rule).toEqual({ beforeText: /a/, afterText: undefined, previousLineText: undefined, action: NONE });
    });

    it("a section that is not an array resolves to no rules", () => {
        expect(resolveLanguageConfiguration({ onEnterRules: "x" } as never).onEnterRules).toEqual([]);
        expect(resolveLanguageConfiguration({}).onEnterRules).toEqual([]);
    });
});
