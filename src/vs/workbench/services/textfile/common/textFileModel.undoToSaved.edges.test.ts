import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import { createInsertEdit } from "../../../../editor/common/core/iTextEdit.ts";

import type { TextFileModel } from "./textFileModel.ts";

// Issue #1010, edge cases: the dirty mark follows "text (and EOL) differs from what is on disk" through undo/redo
// of joined steps, saves in the middle of an open step and EOL changes inside a step.
describe("TextFileModel — undo back to the saved text, edge cases", () => {
    let ws: ITempWorkspace;
    let pane: TextEditorPane<TextFileModel>;
    let path: string;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-undo-to-saved-edges-" });
    });

    afterEach(() => {
        pane.dispose();
        ws.dispose();
    });

    function open(text = "alpha\n"): void {
        pane = createEditorPane({});
        path = ws.writeFile("n.txt", text);
        pane.openFile(Uri.file(path));
    }

    const modified = (): boolean => pane.model.isModified;

    it("a save while a step is still open (no undo stop after it): undo is modified, redo back is clean", async () => {
        open();
        pane.applyExternalEdits([createInsertEdit(0, 0, "1")], "edit", undefined, { undoStopAfter: false });
        await pane.save();
        expect(modified()).toBe(false);

        pane.undo();
        expect(pane.model.getText()).toBe("alpha\n");
        expect(modified()).toBe(true);

        pane.redo();
        expect(pane.model.getText()).toBe("1alpha\n");
        expect(modified()).toBe(false);
    });

    it("an edit joined into the step that was open at save: undo and redo of the whole step are both modified", async () => {
        open();
        pane.applyExternalEdits([createInsertEdit(0, 0, "1")], "edit", undefined, { undoStopAfter: false });
        await pane.save();
        pane.applyExternalEdits([createInsertEdit(0, 0, "2")], "edit", undefined, { undoStopBefore: false });
        expect(modified()).toBe(true);

        pane.undo();
        expect(pane.model.getText()).toBe("alpha\n");
        expect(modified()).toBe(true);

        pane.redo();
        expect(pane.model.getText()).toBe("21alpha\n");
        expect(modified()).toBe(true);
    });

    it("an extension edit with a text change and setEndOfLine (one TextEditor.edit): undoing it all is clean", () => {
        open();
        pane.applyExternalEdits([createInsertEdit(0, 0, "1")], "extension edit");
        pane.setEol(EndOfLine.CRLF);
        expect(modified()).toBe(true);

        while (pane.model.getText() !== "alpha\n" || pane.eol !== EndOfLine.LF) pane.undo();
        expect(modified()).toBe(false);
    });

    it("an edit joined into the last step right after an EOL change: undo back to the disk text is clean", () => {
        open();
        pane.setEol(EndOfLine.CRLF);
        pane.applyEditsIntoLastUndoStep([createInsertEdit(0, 0, "1")], "mirror");
        expect(modified()).toBe(true);

        pane.undo();
        pane.undo();
        expect(pane.model.getText()).toBe("alpha\n");
        expect(pane.eol).toBe(EndOfLine.LF);
        expect(modified()).toBe(false);
    });

    it("an edit joined into the last step right after an EOL change, then saved: redo after undo is clean", async () => {
        open();
        pane.setEol(EndOfLine.CRLF);
        pane.applyEditsIntoLastUndoStep([createInsertEdit(0, 0, "1")], "mirror");
        await pane.save();
        expect(modified()).toBe(false);

        pane.undo();
        expect(modified()).toBe(true);

        pane.redo();
        expect(pane.model.getText()).toBe("1alpha\n");
        expect(pane.eol).toBe(EndOfLine.CRLF);
        expect(modified()).toBe(false);
    });

    it("undo past the save, save there, redo: modified; undo back: clean", async () => {
        open();
        pane.typeText("z");
        await pane.save();
        pane.undo();
        await pane.save();
        expect(modified()).toBe(false);

        pane.redo();
        expect(pane.model.getText()).toBe("zalpha\n");
        expect(modified()).toBe(true);

        pane.undo();
        expect(modified()).toBe(false);
    });

    it("type, undo, type something else, undo: clean (the redo branch is gone)", () => {
        open();
        pane.typeText("x");
        pane.undo();
        pane.typeText("y");
        expect(modified()).toBe(true);
        pane.undo();
        expect(pane.model.getText()).toBe("alpha\n");
        expect(modified()).toBe(false);
    });
});
