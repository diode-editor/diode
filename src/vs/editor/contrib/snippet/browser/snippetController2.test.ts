import { afterEach, describe, expect, it } from "vitest";

import { drawSelections, snippetPane } from "../../../../../TestUtils/snippetPane.ts";
import type { TextEditorPane } from "../../../../workbench/browser/parts/editor/textEditorPane.ts";
import type { TextFileModel } from "../../../../workbench/services/textfile/common/textFileModel.ts";
import { createRange, type IRange } from "../../../common/core/iRange.ts";
import { createCursorSelection, createSelection } from "../../../common/core/iSelection.ts";

import { SnippetController2 } from "./snippetController2.ts";

// Upstream `snippetController2.test.ts` and `snippetSession.test.ts` by meaning, on a real pane.

const at = (line: number, character: number): IRange => createRange(line, character, line, character);

const panes: TextEditorPane<TextFileModel>[] = [];

interface IHarness {
    readonly pane: TextEditorPane<TextFileModel>;
    readonly controller: SnippetController2;
    /** The text with the selections drawn: `[` anchor, `]` active, `|` a caret. */
    frame(): string;
    type(text: string): void;
    deleteLeft(): void;
}

function setup(text: string, template: string, ranges: readonly IRange[] = [at(0, text.length)]): IHarness {
    const pane = snippetPane(text);
    panes.push(pane);
    const controller = SnippetController2.get(pane);
    controller.apply(
        ranges.map((range) => ({ range, template })),
        {},
    );
    return {
        pane,
        controller,
        frame: () => drawSelections(pane),
        type: (typed) => {
            pane.pushUndo(pane.viewState.type(typed));
        },
        deleteLeft: () => {
            pane.pushUndo(pane.viewState.deleteLeft());
        },
    };
}

/** Whether the session is on: the three keys of the workbench. */
function keys({ controller }: IHarness): readonly [boolean, boolean, boolean] {
    return [controller.isInSnippet, controller.hasNextTabstop, controller.hasPrevTabstop];
}

afterEach(() => {
    for (const pane of panes.splice(0)) {
        SnippetController2.get(pane).cancel();
        pane.dispose();
    }
});

describe("SnippetController2: the session", () => {
    it("one controller per editor", () => {
        const pane = snippetPane("");
        panes.push(pane);
        expect(SnippetController2.get(pane)).toBe(SnippetController2.get(pane));
        expect(SnippetController2.get(pane)).not.toBe(SnippetController2.get(snippetPane("")));
    });

    it("a snippet with placeholders starts on the first one; Tab and Shift+Tab walk the groups", () => {
        const h = setup("", "${1:a} ${2:b} ${3:c}");
        expect(h.frame()).toBe("[a] b c");
        expect(keys(h)).toEqual([true, true, false]);
        h.controller.next();
        expect(h.frame()).toBe("a [b] c");
        expect(keys(h)).toEqual([true, true, true]);
        h.controller.prev();
        expect(h.frame()).toBe("[a] b c");
        expect(keys(h)).toEqual([true, true, false]);
    });

    it("Shift+Tab on the first tab stop stays there", () => {
        const h = setup("", "${1:a} ${2:b}");
        h.controller.prev();
        expect(h.frame()).toBe("[a] b");
        expect(h.controller.isInSnippet).toBe(true);
    });

    it("typing goes into every mirror, and Tab to `$0` ends the session", () => {
        const h = setup("", "${1:name} = $1;$0");
        expect(h.frame()).toBe("[name] = [name];");
        h.type("a");
        expect(h.frame()).toBe("a| = a|;");
        expect(h.controller.isInSnippet).toBe(true);
        h.controller.next();
        expect(h.frame()).toBe("a = a;|");
        expect(keys(h)).toEqual([false, false, false]);
        expect(h.pane.viewState.snippetTabstopRanges).toEqual([]);
    });

    it("a snippet without `$0` ends at the end of the insert", () => {
        const h = setup("x", "(${1:a})");
        h.controller.next();
        expect(h.frame()).toBe("x(a)|");
        expect(h.controller.isInSnippet).toBe(false);
    });

    it.each([
        ["plain text", "foo", "foo|"],
        ["only `$0` at the end", "foo$0", "foo|"],
        ["only `$0`, in the middle", "a$0b", "a|b"],
    ])("%s starts no session", (_name, template, frame) => {
        const h = setup("", template);
        expect(h.frame()).toBe(frame);
        expect(keys(h)).toEqual([false, false, false]);
        expect(h.pane.viewState.snippetTabstopRanges).toEqual([]);
    });

    it("an inactive tab stop does not grow when typing at its edge, the active one does", () => {
        const h = setup("", "${1:a}${2:b}");
        h.type("xy");
        expect(h.frame()).toBe("xy|b");
        h.controller.next();
        expect(h.frame()).toBe("xy[b]");
        h.controller.prev();
        expect(h.frame()).toBe("[xy]b");
    });

    it("an enclosing placeholder grows with the nested one, and Shift+Tab selects it whole", () => {
        const h = setup("", "${1:a ${2:b} c}");
        h.controller.next();
        expect(h.frame()).toBe("a [b] c");
        h.type("XY");
        expect(h.frame()).toBe("a XY| c");
        h.controller.prev();
        expect(h.frame()).toBe("[a XY c]");
    });

    it("a group the user deleted is skipped by Tab", () => {
        const h = setup("", "${1:a} ${2:b} ${3:c}");
        h.controller.next();
        h.deleteLeft();
        expect(h.frame()).toBe("a | c");
        h.controller.prev();
        expect(h.frame()).toBe("[a]  c");
        h.controller.next();
        expect(h.frame()).toBe("a  [c]");
    });

    it("an authored empty tab stop is not skipped", () => {
        const h = setup("", "${1:a}$2${3:c}");
        h.controller.next();
        expect(h.frame()).toBe("a|c");
    });

    it("a single caret left in a group of two mirrors ends the session", () => {
        const h = setup("", "${1:a} ${2:b} ${2:b} ${3:c}");
        h.controller.next();
        h.pane.viewState.selections = [createSelection(0, 2, 0, 3)];
        expect(h.controller.isInSnippet).toBe(false);
    });

    it("Escape leaves the session with the primary caret and the text as it is", () => {
        const h = setup("", "${1:x} = $1");
        h.controller.cancel(true);
        expect(h.frame()).toBe("[x] = x");
        expect(keys(h)).toEqual([false, false, false]);
        expect(h.pane.viewState.snippetTabstopRanges).toEqual([]);
    });

    it("cancel without a session changes nothing", () => {
        const h = setup("ab", "c");
        h.controller.cancel(true);
        h.controller.next();
        h.controller.prev();
        expect(h.frame()).toBe("abc|");
    });

    it("a caret moving inside the tab stop keeps the session, one leaving all of them ends it", () => {
        const h = setup("", "${1:abc} x ${2:d}");
        h.pane.viewState.selections = [createCursorSelection(0, 1)];
        expect(h.controller.isInSnippet).toBe(true);
        h.pane.viewState.selections = [createCursorSelection(0, 7)];
        expect(h.controller.isInSnippet).toBe(true);
        h.pane.viewState.selections = [createCursorSelection(0, 4)];
        expect(h.controller.isInSnippet).toBe(false);
    });

    it("a caret on `$0` is outside the tab stops", () => {
        const h = setup("", "${1:a} $0 ${2:b}");
        h.pane.viewState.selections = [createCursorSelection(0, 2)];
        expect(h.controller.isInSnippet).toBe(false);
    });

    it("undo of the insert ends the session; undo of typing inside it does not", () => {
        const h = setup("x", "${1:a} ${2:b}");
        h.type("q");
        h.pane.undo();
        expect(h.frame()).toBe("x[a] b");
        expect(h.controller.isInSnippet).toBe(true);
        h.pane.undo();
        expect(h.controller.isInSnippet).toBe(false);
        expect(h.pane.viewState.document.getText()).toBe("x");
    });

    it("an edit from elsewhere inside a placeholder keeps the session, the ranges ride along", () => {
        const h = setup("", "${1:ab} ${2:c}");
        h.pane.applyExternalEdits([{ range: at(0, 1), text: "ZZ" }], "extension edit");
        expect(h.controller.isInSnippet).toBe(true);
        expect(h.pane.viewState.snippetTabstopRanges).toEqual([createRange(0, 0, 0, 4), createRange(0, 5, 0, 6)]);
        h.controller.next();
        expect(h.frame()).toBe("aZZb [c]");
    });

    it("replacing the whole text ends the session without a trace", () => {
        const h = setup("", "${1:a} ${2:b}");
        h.pane.viewState.document.setText("new");
        expect(keys(h)).toEqual([false, false, false]);
        expect(h.pane.viewState.snippetTabstopRanges).toEqual([]);
    });

    it("the frame ranges leave out `$0` and a placeholder nested in another", () => {
        const h = setup("", "${1:a ${2:b}} $0 ${3:c}");
        expect(h.pane.viewState.snippetTabstopRanges).toEqual([createRange(0, 0, 0, 3), createRange(0, 5, 0, 6)]);
    });

    it("several ranges are one session, Tab moves the caret in each", () => {
        const h = setup("1\n2", "${1:a}-${2:b}", [at(0, 1), at(1, 1)]);
        expect(h.frame()).toBe("1[a]-b\n2[a]-b");
        h.controller.next();
        expect(h.frame()).toBe("1a-[b]\n2a-[b]");
        h.type("Q");
        expect(h.frame()).toBe("1a-Q|\n2a-Q|");
        h.pane.viewState.selections = [h.pane.viewState.selections[1]];
        expect(h.controller.isInSnippet).toBe(false);
    });

    it("a snippet inserted during a session ends it and starts its own", () => {
        const h = setup("", "${1:a} ${2:b}");
        h.controller.apply([{ range: at(0, 2), template: "${1:x}${2:y}" }], {});
        expect(h.frame()).toBe("a [x]yb");
        expect(h.pane.viewState.snippetTabstopRanges).toEqual([createRange(0, 2, 0, 3), createRange(0, 3, 0, 4)]);
        h.controller.next();
        expect(h.frame()).toBe("a x[y]b");
        h.controller.next();
        expect(h.controller.isInSnippet).toBe(false);
    });

    it("overlapping ranges change nothing and keep the session", () => {
        const h = setup("abc", "${1:a} ${2:b}");
        expect(
            h.controller.apply(
                [
                    { range: createRange(0, 0, 0, 2), template: "x" },
                    { range: createRange(0, 1, 0, 3), template: "y" },
                ],
                {},
            ),
        ).toBe(false);
        expect(h.frame()).toBe("abc[a] b");
        expect(h.controller.isInSnippet).toBe(true);
    });

    it("Tab centers a tab stop that is out of the viewport", () => {
        const h = setup("", `\${1:a}${"\n".repeat(50)}\${2:b}${"\n".repeat(50)}`);
        h.pane.viewState.viewportHeight = 10;
        h.controller.next();
        expect(h.pane.viewState.scrollTop).toBe(45);
    });

    it("accept goes on to the end", () => {
        const h = setup("", "${1:a} ${2:b} $0!");
        h.controller.finish();
        expect(h.frame()).toBe("a b |!");
        expect(h.controller.isInSnippet).toBe(false);
    });
});
