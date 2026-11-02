import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { TrashService } from "../../../../platform/files/node/trashService.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import type { TextFileModelService } from "../../../services/textfile/common/textFileModelService.ts";
import type { BulkEdit } from "../common/workspaceEdit.ts";

import { BulkEditBuffers } from "./bulkEditBuffers.ts";
import { WorkspaceEditService } from "./workspaceEditService.ts";

// Issue #1010 through a workspace edit (rename, quick fix across files, `workspace.applyEdit`): its undo/redo goes
// through the undo-redo service, and the dirty mark of every touched tab still follows "text differs from disk".

let ws: ITempWorkspace;

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-ws-edit-undo-to-saved-" });
});

afterEach(() => {
    ws.dispose();
});

const A = "class Foo {}\n";
const B = "new Foo();\n";

function harness(): {
    service: WorkspaceEditService;
    open(name: string, content: string): TextEditorPane;
    file(name: string): string;
} {
    const undoRedo = new UndoRedoService();
    const panes: TextEditorPane[] = [];
    const editors = {
        getActiveTabEditor: () => panes.at(0) ?? null,
        getEditors: () => panes,
        holdFileModel: () => null,
        getFileModelsWithoutEditor: () => [],
        revertSoftBeforeDelete: () => undefined,
    } as unknown as IEditorService;
    const models = { get: () => null } as unknown as TextFileModelService;
    const service = new WorkspaceEditService(
        undoRedo,
        new TrashService(),
        createTestConfigurationService({ "files.enableTrash": false }),
        new BulkEditBuffers(editors, models),
        diskFileService(),
    );
    const dir = fs.mkdtempSync(path.join(ws.dir, "h-"));
    const file = (name: string): string => path.join(dir, name);
    return {
        service,
        file,
        open(name, content) {
            fs.writeFileSync(file(name), content);
            const pane = createEditorPane({ undoRedoService: undoRedo });
            pane.openFile(Uri.file(file(name)));
            panes.push(pane);
            return pane;
        },
    };
}

const resource = (filePath: string): string => Uri.file(filePath).toString();
const replaceFoo = (line: string) =>
    createTextEdit(createRange(0, line.indexOf("Foo"), 0, line.indexOf("Foo") + 3), "Baz");

function renameFoo(file: (name: string) => string): BulkEdit {
    return [
        { resource: resource(file("a.ts")), edits: [replaceFoo(A)] },
        { resource: resource(file("b.ts")), edits: [replaceFoo(B)] },
    ];
}

describe("WorkspaceEditService — undo back to the saved text", () => {
    it("a rename across two clean tabs: undo makes both clean, redo modifies both again", async () => {
        const h = harness();
        const a = h.open("a.ts", A);
        const b = h.open("b.ts", B);

        expect(await h.service.applyWorkspaceEdit(renameFoo(h.file), "Rename")).toBe(true);
        expect(a.isModified).toBe(true);
        expect(b.isModified).toBe(true);

        a.undo();
        await vi.waitFor(() => {
            expect(b.getText()).toBe(B);
        });
        expect(a.getText()).toBe(A);
        expect(a.isModified).toBe(false);
        expect(b.isModified).toBe(false);

        b.redo();
        await vi.waitFor(() => {
            expect(a.getText()).toBe("class Baz {}\n");
        });
        expect(a.isModified).toBe(true);
        expect(b.isModified).toBe(true);
    });

    it("a refactoring saved by files.refactoring.autoSave: undo modifies both, redo back to the saved text is clean", async () => {
        const h = harness();
        const a = h.open("a.ts", A);
        const b = h.open("b.ts", B);

        await h.service.applyWorkspaceEdit(renameFoo(h.file), "Rename", { respectAutoSaveConfig: true });
        expect(a.isModified).toBe(false);
        expect(b.isModified).toBe(false);

        a.undo();
        await vi.waitFor(() => {
            expect(b.getText()).toBe(B);
        });
        expect(a.isModified).toBe(true);
        expect(b.isModified).toBe(true);

        a.redo();
        await vi.waitFor(() => {
            expect(b.getText()).toBe("new Baz();\n");
        });
        expect(a.isModified).toBe(false);
        expect(b.isModified).toBe(false);
    });
});
