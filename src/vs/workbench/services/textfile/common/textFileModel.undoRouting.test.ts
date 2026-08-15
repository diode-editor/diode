import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { UndoRedoService, WORKSPACE_UNDO_CONTEXT } from "../../../../platform/undoRedo/common/undoRedoService.ts";

let tmpDir: string;
let ws: ITempWorkspace;

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-editundo-" });
    tmpDir = ws.dir;
});

afterEach(() => {
    ws.dispose();
});

function make(): { controller: TextEditorPane; undoRedo: UndoRedoService; file: string } {
    const undoRedo = new UndoRedoService();
    const controller = createEditorPane({ undoRedoService: undoRedo });
    const file = path.join(tmpDir, "a.txt");
    fs.writeFileSync(file, "");
    controller.openFile(Uri.file(file));
    return { controller, undoRedo, file };
}

describe("TextFileModel — text undo routes through the unified UndoRedoService", () => {
    it("registers a step under the editor's own context and undo reverts via the service", () => {
        const { controller, undoRedo } = make();

        controller.pushUndo(controller.viewState.type("hello"));
        expect(controller.getText()).toBe("hello");
        expect(undoRedo.canUndo(controller.undoContext)).toBe(true);
        // Not registered under the workspace (file-operations) context.
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);

        controller.undo();
        expect(controller.getText()).toBe("");
        expect(undoRedo.canRedo(controller.undoContext)).toBe(true);
    });

    it("redo re-applies the edit", () => {
        const { controller } = make();
        controller.pushUndo(controller.viewState.type("abc"));
        controller.undo();
        expect(controller.getText()).toBe("");

        controller.redo();
        expect(controller.getText()).toBe("abc");
    });

    it("routes undo under the editor's own context when no file is open", () => {
        const undoRedo = new UndoRedoService();
        const controller = createEditorPane({ undoRedoService: undoRedo });

        controller.pushUndo(controller.viewState.type("hi"));
        expect(undoRedo.canUndo(controller.undoContext)).toBe(true);

        controller.undo();
        expect(controller.getText()).toBe("");

        controller.dispose();
    });

    it("gives each editor its own context, so histories never share a bucket", () => {
        const first = make();
        const second = make();

        expect(first.controller.undoContext).not.toBe(second.controller.undoContext);
    });

    it("clears only this editor's history when the controller is disposed", () => {
        const { controller, undoRedo } = make();
        controller.pushUndo(controller.viewState.type("x"));
        const context = controller.undoContext;
        expect(undoRedo.canUndo(context)).toBe(true);

        controller.dispose();
        expect(undoRedo.canUndo(context)).toBe(false);
    });
});
