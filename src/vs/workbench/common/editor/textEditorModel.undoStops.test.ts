import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import { EndOfLine } from "../../../editor/common/core/endOfLine.ts";
import { createSelection, type ISelection } from "../../../editor/common/core/iSelection.ts";
import { createInsertEdit } from "../../../editor/common/core/iTextEdit.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../editor/common/languages/iLanguageService.ts";
import { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";

import { SyntheticTextModel } from "./syntheticTextModel.ts";
import type { ITextEditTarget } from "./textEditorModel.ts";

class TestModel extends SyntheticTextModel {
    public append(text: string): void {
        this.appendFromDisk(text);
    }

    public replaceUnsaved(text: string): void {
        this.replaceText(text, { unsaved: true });
    }
}

function setup(): TestModel {
    const model = new TestModel(NULL_LANGUAGE_SERVICE, new UndoRedoService(), Uri.parse("output:test"), "log");
    model.replaceContent("x");
    return model;
}

const insert = (
    model: TestModel,
    text: string,
    stops?: { undoStopBefore?: boolean; undoStopAfter?: boolean },
): void => {
    model.applyExternalEdits([createInsertEdit(0, 0, text)], "edit", undefined, undefined, stops);
};

describe("BaseTextEditorModel — undo stops", () => {
    it("no stop between two edits: one undo removes both", () => {
        const model = setup();
        insert(model, "1", { undoStopAfter: false });
        insert(model, "2", { undoStopBefore: false });
        model.undo();
        expect(model.getText()).toBe("x");
    });

    it("a step closed by the first edit stays closed", () => {
        const model = setup();
        insert(model, "1");
        insert(model, "2", { undoStopBefore: false });
        model.undo();
        expect(model.getText()).toBe("1x");
    });

    it("the second edit asking for its own stop isn't joined", () => {
        const model = setup();
        insert(model, "1", { undoStopAfter: false });
        insert(model, "2");
        model.undo();
        expect(model.getText()).toBe("1x");
    });

    it("an edit in between closes the step: the document is no longer at its version", () => {
        const model = setup();
        insert(model, "1", { undoStopAfter: false });
        model.document.applyEdits([createInsertEdit(0, 0, "!")]);
        insert(model, "2", { undoStopBefore: false });
        expect(model.undoManager.undo()).toBe(true);
        expect(model.getText()).toBe("!1x");
    });
});

describe("BaseTextEditorModel — dirty state", () => {
    it("text from disk is not an edit while it arrives", () => {
        const model = setup();
        insert(model, "edit");
        const seen: boolean[] = [];
        model.document.onDidChangeContent(() => seen.push(model.isModified));

        model.replaceContent("disk");
        model.append("+tail");

        expect(seen).toEqual([false, false]);
        expect(model.isModified).toBe(false);
    });

    it("after text from disk an edit is an edit again", () => {
        const model = setup();
        model.append("+tail");
        insert(model, "edit");
        expect(model.isModified).toBe(true);
    });

    it("text that isn't from disk counts as an edit while it arrives", () => {
        const model = setup();
        const seen: boolean[] = [];
        model.document.onDidChangeContent(() => seen.push(model.isModified));
        model.replaceUnsaved("moved");
        expect(seen).toEqual([true]);
    });

    it("a clean document's line ending there and back is clean", () => {
        const model = setup();
        model.setEol(EndOfLine.CRLF);
        expect(model.isModified).toBe(true);
        model.setEol(EndOfLine.LF);
        expect(model.isModified).toBe(false);
    });

    it("a dirty document's line ending there and back stays dirty", () => {
        const model = setup();
        insert(model, "edit");
        model.setEol(EndOfLine.CRLF);
        model.setEol(EndOfLine.LF);
        expect(model.isModified).toBe(true);
    });

    it("a buffer that isn't a file reads as utf8", () => {
        expect(setup().encoding).toBe("utf8");
    });
});

describe("BaseTextEditorModel — the target of a detached edit", () => {
    const target = (): ITextEditTarget & { applyEdits: ReturnType<typeof vi.fn> } => ({
        cloneSelections: () => [],
        applyEdits: vi.fn(() => undefined),
        markDirty: () => undefined,
    });

    it("the given view acts, not the first attached", () => {
        const model = setup();
        const attached = target();
        const given = target();
        model.attachEditTarget(attached);
        model.applyExternalEditsDetached([createInsertEdit(0, 0, "1")], "edit", given);
        expect(given.applyEdits).toHaveBeenCalledOnce();
        expect(attached.applyEdits).not.toHaveBeenCalled();
    });

    it("without one the first attached acts", () => {
        const model = setup();
        const attached = target();
        model.attachEditTarget(attached);
        model.applyExternalEditsDetached([createInsertEdit(0, 0, "1")], "edit");
        expect(attached.applyEdits).toHaveBeenCalledOnce();
    });

    it("a model with no view edits itself; undo into a view restores the start of the document", () => {
        const model = setup();
        insert(model, "1");
        const restored: (readonly ISelection[])[] = [];
        model.undoManager.undo({ restoreSelections: (selections) => restored.push(selections) });
        expect(model.getText()).toBe("x");
        expect(restored).toEqual([[createSelection(0, 0, 0, 0)]]);
    });
});
