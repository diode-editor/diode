import { describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import { createInsertEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";

import { TextFileModel } from "./textFileModel.ts";

/** Programmatic paths (save participants, service commands) work without open editors too. */
describe("TextFileModel — model without attached views", () => {
    function make(): TextFileModel {
        return new TextFileModel(NULL_LANGUAGE_SERVICE, new UndoRedoService(), diskFileService());
    }

    it("setEol without views: the undo step snapshot has no selections, undo()/redo() without views walk the history", () => {
        const model = make();
        expect(model.eol).toBe(EndOfLine.LF);

        model.setEol(EndOfLine.CRLF);
        expect(model.eol).toBe(EndOfLine.CRLF);
        expect(model.isModified).toBe(true);

        model.undo();
        expect(model.eol).toBe(EndOfLine.LF);
        model.redo();
        expect(model.eol).toBe(EndOfLine.CRLF);

        model.dispose();
    });

    it("applyExternalEdits without views edits the document: a live model needs no tab", () => {
        const model = make();

        model.applyExternalEdits([createInsertEdit(0, 0, "hello")], "test edit");

        expect(model.getText()).toBe("hello");
        expect(model.isModified).toBe(true);
        model.undo();
        expect(model.getText()).toBe("");
        model.dispose();
    });

    it("disposing a removed edit target twice is a no-op, another target is unaffected", () => {
        const model = make();
        const calls: string[] = [];
        const target = (name: string) => ({
            cloneSelections: () => [],
            applyEdits: () => {
                calls.push(name);
                return undefined;
            },
            markDirty: () => {},
        });
        const first = model.attachEditTarget(target("first"));
        model.attachEditTarget(target("second"));

        first.dispose();
        first.dispose(); // a second dispose must not remove "second" at index -1

        model.applyExternalEdits([createInsertEdit(0, 0, "x")], "edit");
        expect(calls).toEqual(["second"]);
        model.dispose();
    });

    it("disposing an onDidSaveDocument subscription twice is a no-op", () => {
        const model = make();
        const subscription = model.onDidSaveDocument(() => {});
        model.onDidSaveDocument(() => {});

        subscription.dispose();
        expect(() => {
            subscription.dispose();
        }).not.toThrow();
        model.dispose();
    });
});
