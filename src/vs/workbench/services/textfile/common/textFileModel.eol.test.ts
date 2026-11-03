import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import { createInsertEdit } from "../../../../editor/common/core/iTextEdit.ts";

describe("TextFileModel EOL", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-editorctrl-eol-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function writeFile(name: string, content: string): string {
        return ws.writeFile(name, content);
    }

    it("opens a CRLF file without marking it modified", () => {
        const filePath = writeFile("crlf.txt", "a\r\nb\r\nc");
        const ctrl = createEditorPane();

        ctrl.openFile(Uri.file(filePath));

        expect(ctrl.eol).toBe(EndOfLine.CRLF);
        expect(ctrl.isModified).toBe(false);
    });

    it("round-trips a CRLF file byte-for-byte on save", async () => {
        const original = "line1\r\nline2\r\nline3\r\n";
        const filePath = writeFile("crlf.txt", original);
        const ctrl = createEditorPane();

        ctrl.openFile(Uri.file(filePath));
        await ctrl.save();

        expect(fs.readFileSync(filePath, "utf-8")).toBe(original);
    });

    it("round-trips an LF file byte-for-byte on save", async () => {
        const original = "line1\nline2\nline3\n";
        const filePath = writeFile("lf.txt", original);
        const ctrl = createEditorPane();

        ctrl.openFile(Uri.file(filePath));
        await ctrl.save();

        expect(fs.readFileSync(filePath, "utf-8")).toBe(original);
    });

    it("setEol marks the document modified and writes the new sequence on save", async () => {
        const filePath = writeFile("lf.txt", "a\nb\nc");
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(filePath));
        expect(ctrl.isModified).toBe(false);

        ctrl.setEol(EndOfLine.CRLF);
        expect(ctrl.eol).toBe(EndOfLine.CRLF);
        expect(ctrl.isModified).toBe(true);

        await ctrl.save();
        expect(fs.readFileSync(filePath, "utf-8")).toBe("a\r\nb\r\nc");
        expect(ctrl.isModified).toBe(false);
    });

    it("setting the line ending back leaves an edit made in between unsaved", () => {
        const filePath = writeFile("lf.txt", "a\nb");
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(filePath));

        ctrl.setEol(EndOfLine.CRLF);
        ctrl.applyExternalEdits([createInsertEdit(0, 0, "x")], "edit");
        ctrl.setEol(EndOfLine.LF);

        expect(ctrl.isModified).toBe(true);
    });

    // Issue #1029: an EOL change is an edit like any other (upstream `setEOL`), so a manual change back is one more
    // edit; only undo returns to the saved state.
    it("setting the line ending back by hand on a clean document leaves it modified; a save writes the bytes", async () => {
        const filePath = writeFile("lf.txt", "a\nb");
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(filePath));

        ctrl.setEol(EndOfLine.CRLF);
        ctrl.setEol(EndOfLine.LF);
        expect(ctrl.isModified).toBe(true);

        await ctrl.save();
        expect(ctrl.isModified).toBe(false);
        expect(fs.readFileSync(filePath, "utf-8")).toBe("a\nb");
    });

    it("redo of an eol change makes the document modified again", () => {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(writeFile("lf.txt", "a\nb")));

        ctrl.setEol(EndOfLine.CRLF);
        ctrl.undo();
        ctrl.redo();

        expect(ctrl.eol).toBe(EndOfLine.CRLF);
        expect(ctrl.isModified).toBe(true);
    });

    it("an eol change, an edit and the eol back: modified; three undos: clean", () => {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(writeFile("lf.txt", "a\nb")));

        ctrl.setEol(EndOfLine.CRLF);
        ctrl.applyExternalEdits([createInsertEdit(0, 0, "x")], "edit");
        ctrl.setEol(EndOfLine.LF);
        expect(ctrl.isModified).toBe(true);

        ctrl.undo();
        expect(ctrl.isModified).toBe(true);
        ctrl.undo();
        expect(ctrl.isModified).toBe(true);
        ctrl.undo();
        expect(ctrl.getText()).toBe("a\nb");
        expect(ctrl.isModified).toBe(false);
    });

    it("an eol change after a save: its undo returns to the saved text with the old sequence and is clean", async () => {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(writeFile("lf.txt", "a\nb")));
        ctrl.applyExternalEdits([createInsertEdit(0, 0, "x")], "edit");
        await ctrl.save();

        ctrl.setEol(EndOfLine.CRLF);
        expect(ctrl.isModified).toBe(true);
        ctrl.undo();

        expect(ctrl.eol).toBe(EndOfLine.LF);
        expect(ctrl.getText()).toBe("xa\nb");
        expect(ctrl.isModified).toBe(false);
    });

    it("an eol change while a save streams to disk is not in the file: modified, and its undo is clean", async () => {
        const files = diskFileService();
        const write = files.writeFile.bind(files);
        let duringWrite = (): void => undefined;
        files.writeFile = (resource, value, options) => {
            duringWrite();
            return write(resource, value, options);
        };
        const filePath = writeFile("lf.txt", "a\nb");
        const ctrl = createEditorPane({ files });
        ctrl.openFile(Uri.file(filePath));
        ctrl.applyExternalEdits([createInsertEdit(0, 0, "x")], "edit");
        duringWrite = () => {
            ctrl.setEol(EndOfLine.CRLF);
        };

        expect(await ctrl.save()).toBe("saved");
        expect(fs.readFileSync(filePath, "utf-8")).toBe("xa\nb");
        expect(ctrl.isModified).toBe(true);

        ctrl.undo();
        expect(ctrl.isModified).toBe(false);
    });

    it("a reload from disk with another sequence is clean and reports the eol change", () => {
        const filePath = writeFile("lf.txt", "a\nb");
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(filePath));
        let fired = 0;
        ctrl.onDidChangeEol(() => fired++);

        fs.writeFileSync(filePath, "a\r\nb");
        ctrl.model.revertToDisk();

        expect(ctrl.eol).toBe(EndOfLine.CRLF);
        expect(fired).toBe(1);
        expect(ctrl.isModified).toBe(false);
    });

    it("setEol to the same sequence is a no-op (not modified)", () => {
        const filePath = writeFile("lf.txt", "a\nb");
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(filePath));

        ctrl.setEol(EndOfLine.LF);

        expect(ctrl.isModified).toBe(false);
    });

    it("onDidChangeEol fires on setEol and on undo, surviving openFile re-creation", () => {
        const ctrl = createEditorPane();
        let fired = 0;
        ctrl.onDidChangeEol(() => fired++);

        // Subscribe before openFile: the document is re-created inside, and the listener must survive.
        ctrl.openFile(Uri.file(writeFile("lf.txt", "a\nb")));

        ctrl.setEol(EndOfLine.CRLF);
        expect(fired).toBe(1);

        ctrl.undo();
        expect(fired).toBe(2);
    });

    it("disposing an onDidChangeEol subscription stops delivery, a second dispose is a no-op", () => {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(writeFile("lf.txt", "a\nb")));
        let fired = 0;
        const subscription = ctrl.onDidChangeEol(() => fired++);
        const other = ctrl.onDidChangeEol(() => undefined);

        subscription.dispose();
        subscription.dispose();
        ctrl.setEol(EndOfLine.CRLF);

        expect(fired).toBe(0);
        other.dispose();
    });

    it("undo of an eol change restores the eol and clears the modified flag", () => {
        const filePath = writeFile("lf.txt", "a\nb");
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(filePath));

        ctrl.setEol(EndOfLine.CRLF);
        expect(ctrl.isModified).toBe(true);

        ctrl.undo();

        expect(ctrl.eol).toBe(EndOfLine.LF);
        expect(ctrl.isModified).toBe(false);
    });
});
