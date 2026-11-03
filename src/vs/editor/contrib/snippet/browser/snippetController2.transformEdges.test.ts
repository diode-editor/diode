import { afterEach, describe, expect, it } from "vitest";

import { drawSelections, snippetPane } from "../../../../../TestUtils/snippetPane.ts";
import type { TextEditorPane } from "../../../../workbench/browser/parts/editor/textEditorPane.ts";
import type { TextFileModel } from "../../../../workbench/services/textfile/common/textFileModel.ts";

import { SnippetController2 } from "./snippetController2.ts";

const panes: TextEditorPane<TextFileModel>[] = [];

function setup(text: string, template: string) {
    const pane = snippetPane(text);
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

describe("SnippetController2: placeholder transforms, edges", () => {
    it("coming back and leaving again does not transform the transformed text twice", () => {
        const h = setup("", "${1/(.*)/[$1]/} ${2:y}");
        h.type("a");
        h.controller.next();
        expect(h.frame()).toBe("[a] [y]");
        h.controller.prev();
        h.controller.next();
        expect(h.pane.viewState.document.getText()).toBe("[[a]] y");
    });

    it("upcase works on non-ASCII text", () => {
        const h = setup("", "${1:x} ${1/(.*)/${1:/upcase}/}$0");
        h.type("жёлтый");
        h.controller.next();
        expect(h.pane.viewState.document.getText()).toBe("жёлтый ЖЁЛТЫЙ");
    });

    it("the global flag replaces every match", () => {
        const h = setup("", "${1/-/_/g}$0");
        h.type("a-b-c");
        h.controller.next();
        expect(h.pane.viewState.document.getText()).toBe("a_b_c");
    });

    it("a dollar typed by the user stays literal in the result", () => {
        const h = setup("", "${1/(.*)/<$1>/}$0");
        h.type("$1$&");
        h.controller.next();
        expect(h.pane.viewState.document.getText()).toBe("<$1$&>");
    });

    it("a transformed mirror before the tab stop is transformed too", () => {
        const h = setup("", "${1/(.*)/${1:/capitalize}/} ${1:x}$0");
        h.type("foo");
        h.controller.next();
        expect(h.pane.viewState.document.getText()).toBe("Foo foo");
    });

    it("a multi-line result on an indented line indents every further line", () => {
        const h = setup("    ", "${1/,/\n/g}$0");
        h.type("a,b,c");
        h.controller.next();
        expect(h.pane.viewState.document.getText()).toBe("    a\n    b\n    c");
    });
});
