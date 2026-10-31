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
import { type IUndoRefusal, UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import type { TextFileModelService } from "../../../services/textfile/common/textFileModelService.ts";
import type { BulkEdit } from "../common/workspaceEdit.ts";

import { BulkEditBuffers } from "./bulkEditBuffers.ts";
import { WorkspaceEditService } from "./workspaceEditService.ts";

let ws: ITempWorkspace;

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-undo-across-" });
});

afterEach(() => {
    ws.dispose();
});

const SOURCE = "class Foo {}\nclass Bar {}\n";
const USER = "import { Foo } from './Foo';\n";

interface IHarness {
    service: WorkspaceEditService;
    undoRedo: UndoRedoService;
    refusals: IUndoRefusal[];
    open(name: string, content?: string): TextEditorPane;
    close(pane: TextEditorPane): void;
    file(name: string): string;
}

function harness(settings: Record<string, unknown> = {}): IHarness {
    const undoRedo = new UndoRedoService();
    const refusals: IUndoRefusal[] = [];
    undoRedo.onDidRefuse((refusal) => refusals.push(refusal));
    const panes: TextEditorPane[] = [];
    const editors = {
        getActiveTabEditor: () => panes.at(0) ?? null,
        getEditors: () => panes,
        // No live models here: a closed file takes the disk path this suite is about.
        holdFileModel: () => null,
        getFileModelsWithoutEditor: () => [],
    } as unknown as IEditorService;
    const models = { get: () => null } as unknown as TextFileModelService;
    const service = new WorkspaceEditService(
        undoRedo,
        new TrashService(),
        createTestConfigurationService({ "files.enableTrash": false, ...settings }),
        new BulkEditBuffers(editors, models),
        diskFileService(),
    );
    // A directory per harness: one test can have several.
    const dir = fs.mkdtempSync(path.join(ws.dir, "h-"));
    const file = (name: string): string => path.join(dir, name);
    return {
        service,
        undoRedo,
        refusals,
        file,
        open(name, content) {
            if (content !== undefined) fs.writeFileSync(file(name), content);
            const pane = createEditorPane({ undoRedoService: undoRedo });
            pane.openFile(Uri.file(file(name)));
            panes.push(pane);
            return pane;
        },
        close(pane) {
            panes.splice(panes.indexOf(pane), 1);
            pane.model.dispose();
        },
    };
}

const resource = (filePath: string): string => Uri.file(filePath).toString();
const insertHead = (text: string) => createTextEdit(createRange(0, 0, 0, 0), text);

function moveFoo(h: IHarness): BulkEdit {
    return [
        { kind: "create", to: h.file("Foo.ts") },
        { resource: resource(h.file("Foo.ts")), edits: [insertHead("export class Foo {}\n")] },
        { resource: resource(h.file("a.ts")), edits: [createTextEdit(createRange(0, 0, 1, 0), "")] },
        { resource: resource(h.file("b.ts")), edits: [insertHead("// moved\n")] },
    ];
}

describe("WorkspaceEditService — undo across all touched files", () => {
    it("Ctrl+Z from any open touched tab undoes the whole step", async () => {
        const h = harness();
        const a = h.open("a.ts", SOURCE);
        const b = h.open("b.ts", USER);

        expect(await h.service.applyWorkspaceEdit(moveFoo(h), "Move to a new file")).toBe(true);
        expect(a.getText()).toBe("class Bar {}\n");
        expect(fs.readFileSync(h.file("Foo.ts"), "utf8")).toBe("export class Foo {}\n");

        // Undo from the SECOND tab (not the one where the action was invoked).
        b.undo();
        await vi.waitFor(() => {
            expect(fs.existsSync(h.file("Foo.ts"))).toBe(false);
        });
        expect(a.getText()).toBe(SOURCE);
        expect(b.getText()).toBe(USER);

        // Redo — from the first.
        a.redo();
        await vi.waitFor(() => {
            expect(fs.existsSync(h.file("Foo.ts"))).toBe(true);
        });
        expect(fs.readFileSync(h.file("Foo.ts"), "utf8")).toBe("export class Foo {}\n");
        expect(a.getText()).toBe("class Bar {}\n");
        expect(b.getText()).toBe("// moved\n" + USER);
        expect(h.refusals).toEqual([]);
    });

    it("a sibling file was edited after the step: refusal naming it, nothing is undone", async () => {
        const h = harness();
        const a = h.open("a.ts", SOURCE);
        const b = h.open("b.ts", USER);
        await h.service.applyWorkspaceEdit(moveFoo(h), "Move to a new file");
        b.applyExternalEdits([insertHead("x")], "Typing");

        a.undo();
        await vi.waitFor(() => {
            expect(h.refusals).toHaveLength(1);
        });

        expect(h.refusals[0].message).toBe(
            "Could not undo 'Move to a new file' across all files because changes were made to b.ts",
        );
        expect(a.getText()).toBe("class Bar {}\n");
        expect(fs.existsSync(h.file("Foo.ts"))).toBe(true);
    });

    it("a new file opened AFTER the edit undoes it from its own tab", async () => {
        const h = harness();
        const a = h.open("a.ts", SOURCE);
        h.open("b.ts", USER);
        await h.service.applyWorkspaceEdit(moveFoo(h), "Move to a new file");

        const foo = h.open("Foo.ts");
        expect(foo.getText()).toBe("export class Foo {}\n");
        foo.undo();

        await vi.waitFor(() => {
            expect(fs.existsSync(h.file("Foo.ts"))).toBe(false);
        });
        expect(a.getText()).toBe(SOURCE);
    });

    it("the tab holding the step's edit was closed: undo refuses and resets the history", async () => {
        const h = harness();
        const a = h.open("a.ts", SOURCE);
        const b = h.open("b.ts", USER);
        await h.service.applyWorkspaceEdit(moveFoo(h), "Move to a new file");

        h.close(b);
        a.undo();
        await vi.waitFor(() => {
            expect(h.refusals).toHaveLength(1);
        });

        expect(h.refusals[0].message).toBe(
            "Could not undo 'Move to a new file' across all files. The following files have been closed and modified on disk: b.ts.",
        );
        expect(fs.existsSync(h.file("Foo.ts"))).toBe(true);
        expect(h.undoRedo.canUndo(a.undoContext)).toBe(false);
    });
});

describe("WorkspaceEditService — the buffer with the step's edit was reloaded from disk", () => {
    it("undo refuses: the file was changed incompatibly (upstream string)", async () => {
        const h = harness();
        const a = h.open("a.ts", SOURCE);
        const b = h.open("b.ts", USER);
        await h.service.applyWorkspaceEdit(moveFoo(h), "Move to a new file");

        b.fileModel?.revertToDisk();
        a.undo();
        await vi.waitFor(() => {
            expect(h.refusals).toHaveLength(1);
        });

        expect(h.refusals[0].message).toBe(
            "Could not undo 'Move to a new file' across all files. The following files have been modified in an incompatible way: b.ts.",
        );
    });
});

describe("WorkspaceEditService — files.refactoring.autoSave", () => {
    it("a refactoring across more than one resource saves its dirty buffers", async () => {
        const h = harness();
        const a = h.open("a.ts", SOURCE);
        const b = h.open("b.ts", USER);

        await h.service.applyWorkspaceEdit(moveFoo(h), "Move to a new file", { respectAutoSaveConfig: true });

        expect(a.isModified).toBe(false);
        expect(b.isModified).toBe(false);
        expect(fs.readFileSync(h.file("a.ts"), "utf8")).toBe("class Bar {}\n");
        expect(fs.readFileSync(h.file("b.ts"), "utf8")).toBe("// moved\n" + USER);
    });

    it("a file and a file operation are two resources: the source is saved", async () => {
        const h = harness();
        const a = h.open("a.ts", SOURCE);

        await h.service.applyWorkspaceEdit(
            [
                { kind: "create", to: h.file("Foo.ts"), contents: "export class Foo {}\n" },
                { resource: resource(h.file("a.ts")), edits: [createTextEdit(createRange(0, 0, 1, 0), "")] },
            ],
            "Move to a new file",
            { respectAutoSaveConfig: true },
        );

        expect(a.isModified).toBe(false);
    });

    it("does not save: single resource, edit is not a refactoring, setting is off", async () => {
        const single = harness();
        const one = single.open("a.ts", SOURCE);
        await single.service.applyWorkspaceEdit(
            [{ resource: resource(single.file("a.ts")), edits: [insertHead("x")] }],
            "Fix",
            { respectAutoSaveConfig: true },
        );
        expect(one.isModified).toBe(true);

        const plain = harness();
        const a = plain.open("a.ts", SOURCE);
        plain.open("b.ts", USER);
        await plain.service.applyWorkspaceEdit(moveFoo(plain), "Workspace Edit");
        expect(a.isModified).toBe(true);

        const off = harness({ "files.refactoring.autoSave": false });
        const c = off.open("a.ts", SOURCE);
        off.open("b.ts", USER);
        await off.service.applyWorkspaceEdit(moveFoo(off), "Move", { respectAutoSaveConfig: true });
        expect(c.isModified).toBe(true);
    });

    it("one failed save does not block the others and does not fail the edit", async () => {
        const h = harness();
        const a = h.open("a.ts", SOURCE);
        const b = h.open("b.ts", USER);
        vi.spyOn(a, "save").mockRejectedValue(new Error("disk full"));

        expect(
            await h.service.applyWorkspaceEdit(moveFoo(h), "Move to a new file", { respectAutoSaveConfig: true }),
        ).toBe(true);

        expect(a.isModified).toBe(true);
        expect(b.isModified).toBe(false);
    });
});
