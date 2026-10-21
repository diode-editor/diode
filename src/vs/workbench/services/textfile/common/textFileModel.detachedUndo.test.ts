import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { UndoRedoService, WORKSPACE_UNDO_CONTEXT } from "../../../../platform/undoRedo/common/undoRedoService.ts";

// `applyExternalEditsDetached` is the bulk edit seam: the edit lands in the document history, while
// the caller takes the shared history step to build ONE step for the whole `workspace.applyEdit`.

let tmpDir: string;
let ws: ITempWorkspace;

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-detached-undo-" });
    tmpDir = ws.dir;
});

afterEach(() => {
    ws.dispose();
});

function openPane(undoRedo: UndoRedoService, name: string, content: string): TextEditorPane {
    const pane = createEditorPane({ undoRedoService: undoRedo });
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, content);
    pane.openFile(Uri.file(file));
    return pane;
}

const insertHead = (text: string): ReturnType<typeof createTextEdit> => createTextEdit(createRange(0, 0, 0, 0), text);

function spyEditTarget(pane: TextEditorPane): { markDirtyCalls: () => number } {
    let calls = 0;
    pane.model.attachEditTarget({
        cloneSelections: () => [],
        applyEdits: () => undefined,
        markDirty: () => {
            calls += 1;
        },
    });
    return { markDirtyCalls: () => calls };
}

describe("TextFileModel.applyExternalEditsDetached", () => {
    it("the edit applies, but the step does NOT go into the document bucket: it is handed to the caller", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");

        const step = pane.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit");

        expect(pane.getText()).toBe("head\nbody");
        expect(step).not.toBeNull();
        expect(undoRedo.canUndo(pane.undoContext)).toBe(false);
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
        expect(step?.label).toBe("Workspace Edit");
    });

    it("the handed-out step undoes and redoes the document edit", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");
        const step = pane.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit")!;

        void step.undo();
        expect(pane.getText()).toBe("body");
        void step.redo();
        expect(pane.getText()).toBe("head\nbody");
    });

    it("the step refuses to undo if text was typed in the document after it", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");
        const step = pane.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit")!;

        pane.pushUndo(pane.viewState.type("typed"));

        expect(step.canUndo?.()).toBe(false);
        pane.undo();
        expect(pane.getText()).toBe("head\nbody");
        expect(step.canUndo?.()).toBe(true);
    });

    it("the history step names the path of the document it touches", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");
        const step = pane.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit")!;

        expect(step.resources).toEqual([pane.absoluteFilePath]);
    });

    it("for an untitled buffer the step names no paths, it is not on disk yet", () => {
        const pane = createEditorPane({ undoRedoService: new UndoRedoService() });
        const step = pane.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit")!;

        expect(pane.absoluteFilePath).toBeNull();
        expect(step.resources).toEqual([]);
    });

    it("apply and undo broadcast 'buffer changed' to all attached views", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");
        const spy = spyEditTarget(pane);

        const step = pane.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit")!;
        const afterApply = spy.markDirtyCalls();
        expect(afterApply).toBeGreaterThan(0);

        void step.undo();
        const afterUndo = spy.markDirtyCalls();
        expect(afterUndo).toBeGreaterThan(afterApply);

        void step.redo();
        expect(spy.markDirtyCalls()).toBeGreaterThan(afterUndo);
    });

    it("without an explicit target the edit goes to the FIRST attached view, not nowhere", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");

        const step = pane.model.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit");

        expect(step).not.toBeNull();
        expect(pane.getText()).toBe("head\nbody");
    });

    it("the step refuses to redo if text was typed in the document after undo", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");
        const step = pane.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit")!;
        void step.undo();
        expect(step.canRedo?.()).toBe(true);

        // Typing clears the redo stack, so our step is no longer on top there.
        pane.pushUndo(pane.viewState.type("typed"));

        expect(step.canRedo?.()).toBe(false);
    });

    it("the step refuses to redo until it is undone", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");
        const step = pane.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit")!;

        expect(step.canRedo?.()).toBe(false);
        void step.undo();
        expect(step.canRedo?.()).toBe(true);
    });

    it("steps of TWO documents combine into one set and undo together", () => {
        const undoRedo = new UndoRedoService();
        const a = openPane(undoRedo, "a.txt", "alpha");
        const b = openPane(undoRedo, "b.txt", "beta");

        const steps = [
            a.applyExternalEditsDetached([insertHead("A")], "Refactor")!,
            b.applyExternalEditsDetached([insertHead("B")], "Refactor")!,
        ];
        expect(a.getText()).toBe("Aalpha");
        expect(b.getText()).toBe("Bbeta");

        undoRedo.pushElement(
            {
                label: "Refactor",
                resources: [],
                canUndo: () => steps.every((s) => s.canUndo?.() !== false),
                undo: () => {
                    for (const s of [...steps].reverse()) void s.undo();
                },
                redo: () => {
                    for (const s of steps) void s.redo();
                },
            },
            a.undoContext,
        );

        void undoRedo.undo(a.undoContext);
        expect(a.getText()).toBe("alpha");
        expect(b.getText()).toBe("beta");
    });

    it("nothing to apply (empty batch) returns null, not a made-up step", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");
        expect(pane.applyExternalEditsDetached([], "Workspace Edit")).toBeNull();
        expect(pane.getText()).toBe("body");
    });

    it("a model step WITHOUT an attached view is not made up: null (nothing to apply the edit with)", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");
        const model = pane.model;
        pane.component.dispose();
        expect(model.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit")).toBeNull();
        expect(model.getText()).toBe("body");
    });

    it("a regular applyExternalEdits after detached puts the step into the document bucket again", () => {
        const undoRedo = new UndoRedoService();
        const pane = openPane(undoRedo, "a.txt", "body");

        pane.applyExternalEditsDetached([insertHead("head\n")], "Workspace Edit");
        pane.applyExternalEdits([insertHead("top\n")], "Trim");

        expect(undoRedo.canUndo(pane.undoContext)).toBe(true);
        expect(undoRedo.peekUndo(pane.undoContext)?.label).toBe("Trim");
    });
});
