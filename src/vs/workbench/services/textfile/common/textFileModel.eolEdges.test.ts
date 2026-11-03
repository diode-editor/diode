import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import { createDeleteEdit, createInsertEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";

import { TextFileModel } from "./textFileModel.ts";

describe("TextFileModel EOL edges", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-eol-edges-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    it("save after an eol change, then undo: modified; redo: clean again", async () => {
        const filePath = ws.writeFile("lf.txt", "a\nb");
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(filePath));

        ctrl.setEol(EndOfLine.CRLF);
        await ctrl.save();
        expect(fs.readFileSync(filePath, "utf-8")).toBe("a\r\nb");
        expect(ctrl.isModified).toBe(false);

        ctrl.undo();
        expect(ctrl.eol).toBe(EndOfLine.LF);
        expect(ctrl.isModified).toBe(true);

        ctrl.redo();
        expect(ctrl.eol).toBe(EndOfLine.CRLF);
        expect(ctrl.isModified).toBe(false);
    });

    it("ten toggles then ten undos: clean with the original sequence", () => {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(ws.writeFile("lf.txt", "a\nb")));

        for (let i = 0; i < 10; i++) {
            ctrl.setEol(i % 2 === 0 ? EndOfLine.CRLF : EndOfLine.LF);
            expect(ctrl.isModified).toBe(true);
        }
        for (let i = 0; i < 9; i++) {
            ctrl.undo();
            expect(ctrl.isModified).toBe(true);
        }
        ctrl.undo();
        expect(ctrl.eol).toBe(EndOfLine.LF);
        expect(ctrl.isModified).toBe(false);
    });

    it("setEol to the same sequence puts no step on the stack: one undo returns to clean", () => {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(ws.writeFile("lf.txt", "a\nb")));

        ctrl.setEol(EndOfLine.CRLF);
        ctrl.setEol(EndOfLine.CRLF);
        ctrl.undo();

        expect(ctrl.eol).toBe(EndOfLine.LF);
        expect(ctrl.isModified).toBe(false);
    });

    it("revert after an eol change is clean with the disk sequence", () => {
        const filePath = ws.writeFile("lf.txt", "a\nb");
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(filePath));

        ctrl.setEol(EndOfLine.CRLF);
        ctrl.model.revertToDisk();

        expect(ctrl.eol).toBe(EndOfLine.LF);
        expect(ctrl.isModified).toBe(false);
    });

    it("an edit undone after an eol change leaves the eol change unsaved", () => {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(ws.writeFile("lf.txt", "a\nb")));

        ctrl.setEol(EndOfLine.CRLF);
        ctrl.applyExternalEdits([createInsertEdit(0, 0, "x")], "edit");
        ctrl.undo();

        expect(ctrl.eol).toBe(EndOfLine.CRLF);
        expect(ctrl.isModified).toBe(true);
    });

    it("save as after an eol change writes the new sequence and is clean", async () => {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(ws.writeFile("lf.txt", "a\nb")));
        ctrl.setEol(EndOfLine.CRLF);

        const target = ws.path("out.txt");
        await ctrl.model.saveAs(target);

        expect(fs.readFileSync(target, "utf-8")).toBe("a\r\nb");
        expect(ctrl.isModified).toBe(false);
        ctrl.undo();
        expect(ctrl.isModified).toBe(true);
    });
});

describe("Untitled EOL edges", () => {
    function make(): TextFileModel {
        return new TextFileModel(NULL_LANGUAGE_SERVICE, new UndoRedoService(), diskFileService());
    }

    it("non-empty untitled: an eol change keeps it dirty", () => {
        const model = make();
        model.applyExternalEdits([createInsertEdit(0, 0, "a\nb")], "edit");
        model.setEol(EndOfLine.CRLF);
        expect(model.isModified).toBe(true);
        model.dispose();
    });

    it("empty untitled: eol change, type, delete: clean", () => {
        const model = make();
        model.setEol(EndOfLine.CRLF);
        model.applyExternalEdits([createInsertEdit(0, 0, "x")], "edit");
        expect(model.isModified).toBe(true);
        model.applyExternalEdits([createDeleteEdit(0, 0, 0, 1)], "edit");
        expect(model.isModified).toBe(false);
        model.undo();
        expect(model.isModified).toBe(true);
        model.undo();
        expect(model.isModified).toBe(false);
        model.undo();
        expect(model.isModified).toBe(false);
        model.dispose();
    });
});
