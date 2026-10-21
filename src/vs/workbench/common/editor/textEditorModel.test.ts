import { describe, expect, it } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import { EndOfLine } from "../../../editor/common/core/endOfLine.ts";
import { createCursorSelection, type ISelection } from "../../../editor/common/core/iSelection.ts";
import { createInsertEdit } from "../../../editor/common/core/iTextEdit.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../editor/common/languages/iLanguageService.ts";
import { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";

import { SyntheticTextModel } from "./syntheticTextModel.ts";
import type { ITextEditTarget } from "./textEditorModel.ts";

describe("BaseTextEditorModel", () => {
    function setup() {
        const undoRedo = new UndoRedoService();
        const model = new SyntheticTextModel(NULL_LANGUAGE_SERVICE, undoRedo, Uri.parse("output:test"), "log");
        model.replaceContent("a\nb\n");
        return { undoRedo, model };
    }

    function fakeTarget(selections: ISelection[]): ITextEditTarget & { dirtied: number } {
        const target = {
            dirtied: 0,
            cloneSelections: () => [...selections],
            applyEdits: () => undefined,
            markDirty: () => {
                target.dirtied++;
            },
        };
        return target;
    }

    function recordingView() {
        const restored: (readonly ISelection[])[] = [];
        return { restored, restoreSelections: (selections: readonly ISelection[]) => restored.push(selections) };
    }

    it("changing EOL is a labeled history step with no resources for a buffer without a file; the same EOL adds no step", () => {
        const { undoRedo, model } = setup();

        model.setEol(EndOfLine.LF);
        expect(undoRedo.peekUndo(model.undoContext)).toBeUndefined();

        model.setEol(EndOfLine.CRLF);
        const step = undoRedo.peekUndo(model.undoContext);
        expect(step?.label).toBe("Change End of Line Sequence");
        expect(step?.resources).toEqual([]);
        expect(model.eol).toBe(EndOfLine.CRLF);
    });

    it("changing EOL without an explicit view takes the selections of the first attached one; undo/redo restore them to the acting view", () => {
        const { model } = setup();
        const first = fakeTarget([createCursorSelection(1, 0)]);
        model.attachEditTarget(first);
        model.attachEditTarget(fakeTarget([createCursorSelection(0, 0)]));
        model.setEol(EndOfLine.CRLF);

        const view = recordingView();
        model.undo(view);
        expect(model.eol).toBe(EndOfLine.LF);
        model.redo(view);
        expect(model.eol).toBe(EndOfLine.CRLF);

        expect(view.restored).toEqual([[createCursorSelection(1, 0)], [createCursorSelection(1, 0)]]);
    });

    it("changing EOL and programmatic edits repaint all attached views", () => {
        const { model } = setup();
        const a = fakeTarget([]);
        const b = fakeTarget([]);
        model.attachEditTarget(a);
        model.attachEditTarget(b);

        model.setEol(EndOfLine.CRLF);
        model.applyExternalEdits([createInsertEdit(0, 0, "x")], "edit");
        model.appendContent("tail\n");

        expect([a.dirtied, b.dirtied]).toEqual([3, 3]);
    });

    it("each model has its own undo context", () => {
        const { model } = setup();
        const other = setup().model;

        expect(other.undoContext).not.toBe(model.undoContext);
    });

    it("changing EOL without an attached view records empty selections", () => {
        const { model } = setup();
        model.setEol(EndOfLine.CRLF);

        const view = recordingView();
        model.undo(view);

        expect(view.restored).toEqual([[]]);
    });

    it("the acting view lives for one call: a step undone bypassing the model does not touch it", () => {
        const { undoRedo, model } = setup();
        model.setEol(EndOfLine.CRLF);
        model.setEol(EndOfLine.LF);
        const view = recordingView();

        model.undo(view);
        void undoRedo.undo(model.undoContext);
        model.redo(view);
        void undoRedo.redo(model.undoContext);

        expect(model.eol).toBe(EndOfLine.LF);
        expect(view.restored).toHaveLength(2);
    });

    it("disposing the model clears its undo history", () => {
        const { undoRedo, model } = setup();
        model.setEol(EndOfLine.CRLF);
        expect(undoRedo.peekUndo(model.undoContext)).toBeDefined();

        model.dispose();

        expect(undoRedo.peekUndo(model.undoContext)).toBeUndefined();
    });
});
