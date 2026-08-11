import { describe, expect, it } from "vitest";

import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import { createInsertEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";

import { TextFileModel } from "./textFileModel.ts";

/**
 * Модель без единой прикреплённой вью: программные пути (save-участники,
 * сервисные команды) работают до/вне открытых редакторов — выделений брать
 * неоткуда, но правки и история обязаны вести себя как обычно.
 */
describe("TextFileModel — модель без прикреплённых вью", () => {
    function make(): TextFileModel {
        return new TextFileModel(NULL_LANGUAGE_SERVICE, new UndoRedoService());
    }

    it("setEol без вью: снимок undo-шага без выделений, undo()/redo() без вью гоняют историю", () => {
        const model = make();
        expect(model.eol).toBe(EndOfLine.LF);

        model.setEol(EndOfLine.CRLF);
        expect(model.eol).toBe(EndOfLine.CRLF);
        expect(model.isModified).toBe(true);

        // Откат и повтор без действующей вью — восстанавливать выделения некому,
        // но сам EOL обязан ходить туда-обратно.
        model.undo();
        expect(model.eol).toBe(EndOfLine.LF);
        model.redo();
        expect(model.eol).toBe(EndOfLine.CRLF);

        model.dispose();
    });

    it("applyExternalEdits без вью — no-op: применять правку некому", () => {
        const model = make();

        model.applyExternalEdits([createInsertEdit(0, 0, "hello")], "test edit");

        expect(model.getText()).toBe("");
        expect(model.isModified).toBe(false);
        model.dispose();
    });

    it("повторный dispose снятой edit-цели — no-op, чужая цель не задета", () => {
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
        first.dispose(); // второй dispose не должен снять «second» по индексу -1

        model.applyExternalEdits([createInsertEdit(0, 0, "x")], "edit");
        expect(calls).toEqual(["second"]);
        model.dispose();
    });

    it("повторный dispose подписки onDidSaveDocument — no-op", () => {
        const model = make();
        const subscription = model.onDidSaveDocument(() => {});
        model.onDidSaveDocument(() => {});

        subscription.dispose();
        expect(() => subscription.dispose()).not.toThrow();
        model.dispose();
    });
});
