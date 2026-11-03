import { afterEach, describe, expect, it } from "vitest";

import { drawSelections, snippetPane } from "../../../../../TestUtils/snippetPane.ts";
import type { TextEditorPane } from "../../../../workbench/browser/parts/editor/textEditorPane.ts";
import type { TextFileModel } from "../../../../workbench/services/textfile/common/textFileModel.ts";
import { createRange } from "../../../common/core/iRange.ts";

import { SnippetController2 } from "./snippetController2.ts";

// Upstream `snippetSession.test.ts` (`Snippet Transform …`) and `snippetController2.test.ts` by meaning.

const panes: TextEditorPane<TextFileModel>[] = [];

function setup(text: string, template: string, indent: { insertSpaces?: boolean } = {}) {
    const pane = snippetPane(text, indent);
    panes.push(pane);
    const controller = SnippetController2.get(pane);
    const lines = text.split("\n");
    const end = { line: lines.length - 1, character: lines[lines.length - 1].length };
    controller.apply([{ range: { start: end, end }, template }], {});
    return {
        pane,
        controller,
        frame: () => drawSelections(pane),
        type: (typed: string) => {
            pane.pushUndo(pane.viewState.type(typed));
        },
    };
}

afterEach(() => {
    for (const pane of panes.splice(0)) {
        SnippetController2.get(pane).cancel();
        pane.dispose();
    }
});

describe("SnippetController2: placeholder transforms", () => {
    it("Tab applies the transform to what was typed", () => {
        const h = setup("", "${1/^_(.*)/$1/} $2");
        h.type("_foo");
        expect(h.frame()).toBe("_foo| ");
        h.controller.next();
        expect(h.frame()).toBe("foo |");
    });

    it("each mirror is transformed by its own transform, a mirror without one keeps the text", () => {
        const h = setup("", "${1:x} ${1/(.*)/${1:/upcase}/} ${1/(.*)/${1:/downcase}/} $0");
        h.type("aB");
        expect(h.frame()).toBe("aB| aB| aB| ");
        h.controller.next();
        expect(h.frame()).toBe("aB AB ab |");
    });

    it("an untouched tab stop transforms the empty string", () => {
        const h = setup("", "${1/^$/none/}-$2");
        h.controller.next();
        expect(h.frame()).toBe("none-|");
    });

    it("a transform that does not match keeps the text", () => {
        const h = setup("", "${1/^_(.*)/$1/} $2");
        h.type("foo");
        h.controller.next();
        expect(h.frame()).toBe("foo |");
    });

    it("Shift+Tab transforms the group it leaves too", () => {
        const h = setup("", "${1:a} ${2/(.*)/${1:/upcase}/}");
        h.controller.next();
        h.type("bc");
        h.controller.prev();
        expect(h.frame()).toBe("[a] BC");
        expect(h.controller.isInSnippet).toBe(true);
    });

    it("the transform of the group before the last one is applied when the session ends", () => {
        const h = setup("", "${1/(.*)/${1:/upcase}/}");
        h.type("ab");
        h.controller.next();
        expect(h.frame()).toBe("AB|");
        expect(h.controller.isInSnippet).toBe(false);
    });

    it("accept transforms every group on its way to the end", () => {
        const h = setup("", "${1/(.*)/${1:/upcase}/} ${2/^$/two/}");
        h.type("ab");
        h.controller.finish();
        expect(h.frame()).toBe("AB two|");
    });

    it("further lines of a multi-line result get the indentation of the snippet's line", () => {
        const h = setup("    ", "${1/(.*)/$1\n\t$1/} $2", { insertSpaces: true });
        h.type("x");
        h.controller.next();
        expect(h.pane.viewState.document.getText()).toBe("    x\n        x ");
        expect(h.frame()).toBe("    x\n        x |");
    });

    it("the indentation follows the tab settings", () => {
        const h = setup("    ", "${1/(.*)/$1\n$1/}$2", { insertSpaces: false });
        h.type("x");
        h.controller.next();
        expect(h.pane.viewState.document.getText()).toBe("    x\n\tx");
    });

    it("undo takes the transform back as its own step, with the caret back in the tab stop", () => {
        const h = setup("", "${1/(.*)/${1:/upcase}/} $2");
        h.type("ab");
        h.controller.next();
        expect(h.frame()).toBe("AB |");
        h.pane.undo();
        expect(h.pane.viewState.document.getText()).toBe("ab ");
        expect(h.controller.isInSnippet).toBe(true);
        h.pane.undo();
        expect(h.pane.viewState.document.getText()).toBe(" ");
    });

    it("the tab stops ride along with a transform that changes the length", () => {
        const h = setup("", "${1/(.*)/($1)/} ${2:b} ${3:c}");
        h.type("a");
        h.controller.next();
        expect(h.frame()).toBe("(a) [b] c");
        expect(h.pane.viewState.snippetTabstopRanges).toEqual([
            createRange(0, 0, 0, 3),
            createRange(0, 4, 0, 5),
            createRange(0, 6, 0, 7),
        ]);
        h.controller.next();
        expect(h.frame()).toBe("(a) b [c]");
    });
});
