import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";

// Terminal focus reports (mode 1004) arrive on stdin between keys: `CSI O` on focus out, `CSI I` on focus in.
// They must never reach the editor as keys — a bare `CSI I` used to be the Tab key.

describe("Workbench — terminal focus reports are not keys", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-focus-reports-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function open(): { h: IAppHarness; editor: EditorElement } {
        const h = createAppTestHarness({ openFile: ws.writeFile("a.txt", "x\n") });
        h.workbench.focusEditor();
        const editor = h.testApp.querySelector("EditorElement") as EditorElement;
        return { h, editor };
    }

    it("CSI O then CSI I in a focused editor insert nothing", () => {
        const { h, editor } = open();
        h.testApp.backend.sendRaw("\x1b[O");
        h.testApp.backend.sendRaw("\x1b[I");
        expect(editor.viewState.document.getText()).toBe("x\n");
    });

    it("a report in the middle of typing, in one read, leaves only the typed characters", () => {
        const { h, editor } = open();
        h.testApp.backend.sendRaw("a\x1b[Ob\x1b[Ic");
        expect(editor.viewState.document.getText()).toBe("abcx\n");
    });

    it("a CSI I split between two reads is still a focus report, not a Tab", () => {
        const { h, editor } = open();
        h.testApp.backend.sendRaw("\x1b[O");
        h.testApp.backend.sendRaw("\x1b[");
        h.testApp.backend.sendRaw("I");
        expect(editor.viewState.document.getText()).toBe("x\n");
    });
});
