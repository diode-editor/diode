import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import { createInsertEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { IFileService } from "../../../../platform/files/common/files.ts";

import type { TextFileModel } from "./textFileModel.ts";

// Issue #1010: the document is modified exactly when its text differs from the saved one — undo back to the saved
// text clears the dirty mark, redo brings it back (upstream's alternative version id).
describe("TextFileModel — undo back to the saved text", () => {
    let ws: ITempWorkspace;
    let pane: TextEditorPane<TextFileModel>;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-undo-to-saved-" });
    });

    afterEach(() => {
        pane.dispose();
        ws.dispose();
    });

    function open(text = "alpha\n", files?: IFileService): void {
        pane = createEditorPane(files === undefined ? {} : { files });
        pane.openFile(Uri.file(ws.writeFile("n.txt", text)));
    }

    const modified = (): boolean => pane.model.isModified;

    it("type, undo: clean; redo: modified again", () => {
        open();
        pane.typeText("x");
        expect(modified()).toBe(true);

        pane.undo();
        expect(pane.model.getText()).toBe("alpha\n");
        expect(modified()).toBe(false);

        pane.redo();
        expect(pane.model.getText()).toBe("xalpha\n");
        expect(modified()).toBe(true);
    });

    it("a save in the middle of the history moves the saved state: undo to it is clean, undo past it is modified", async () => {
        open();
        pane.typeText("z");
        await pane.save();
        pane.typeText("w");

        pane.undo();
        expect(pane.model.getText()).toBe("zalpha\n");
        expect(modified()).toBe(false);

        pane.redo();
        expect(modified()).toBe(true);

        pane.undo();
        pane.undo();
        expect(pane.model.getText()).toBe("alpha\n");
        expect(modified()).toBe(true);

        pane.redo();
        expect(modified()).toBe(false);
    });

    it("a multi-edit step (Format Document) on a clean file: undo is clean", () => {
        open("a\nb\n");
        pane.applyExternalEdits([createInsertEdit(0, 0, "  "), createInsertEdit(1, 0, "  ")], "Format Document");
        expect(modified()).toBe(true);

        pane.undo();
        expect(modified()).toBe(false);
    });

    it("a multi-edit step on a modified file: its undo is still modified, the next undo is clean", () => {
        open("a\nb\n");
        pane.typeText("x");
        pane.applyExternalEdits([createInsertEdit(0, 0, "  "), createInsertEdit(1, 0, "  ")], "Format Document");

        pane.undo();
        expect(modified()).toBe(true);
        pane.undo();
        expect(modified()).toBe(false);
    });

    it("steps joined without an undo stop: one undo back to the saved text is clean", () => {
        open();
        pane.applyExternalEdits([createInsertEdit(0, 0, "1")], "edit", undefined, { undoStopAfter: false });
        pane.applyExternalEdits([createInsertEdit(0, 0, "2")], "edit", undefined, { undoStopBefore: false });
        pane.applyEditsIntoLastUndoStep([createInsertEdit(0, 0, "3")], "mirror");

        pane.undo();
        expect(pane.model.getText()).toBe("alpha\n");
        expect(modified()).toBe(false);

        pane.redo();
        expect(pane.model.getText()).toBe("321alpha\n");
        expect(modified()).toBe(true);
    });

    it("an edit, an EOL change, then undo of both: clean", () => {
        open();
        pane.typeText("x");
        pane.setEol(EndOfLine.CRLF);

        pane.undo();
        expect(pane.eol).toBe(EndOfLine.LF);
        expect(modified()).toBe(true);
        pane.undo();
        expect(modified()).toBe(false);
    });

    it("an edit typed while a save streams to disk stays modified, and one undo makes the buffer clean", async () => {
        const files = diskFileService();
        const write = files.writeFile.bind(files);
        let typeDuringWrite = (): void => undefined;
        files.writeFile = (resource, value, options) => {
            typeDuringWrite();
            return write(resource, value, options);
        };
        open("alpha\n", files);
        pane.typeText("z");
        typeDuringWrite = () => {
            pane.typeText("w");
        };

        expect(await pane.save()).toBe("saved");
        expect(pane.model.getText()).toBe("zwalpha\n");
        expect(modified()).toBe(true);

        pane.undo();
        expect(modified()).toBe(false);
    });

    it("a reload from disk is clean, and a later edit and its undo are clean again", () => {
        open();
        pane.typeText("x");
        pane.model.revertSoft();
        expect(modified()).toBe(false);

        pane.typeText("y");
        pane.undo();
        expect(modified()).toBe(false);
    });
});
