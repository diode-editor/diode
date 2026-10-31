import * as fs from "node:fs";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import { DialogServiceDIToken } from "../../dialogs/browser/dialogService.ts";
import type { TextFileModel } from "../../textfile/common/textFileModel.ts";
import { EditorServiceDIToken } from "../common/editorService.ts";

describe("EditorService — file models without an editor", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-held-models-",
            files: { "a.txt": "a", "dir/b.txt": "b" },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(120, 30) });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const service = () => h.container.get(EditorServiceDIToken);
    const files = () => h.container.get(IFileServiceDIToken);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    function hold(name: string): TextFileModel {
        const model = service().holdFileModel(Uri.file(ws.path(name)));
        if (model === null) throw new Error("expected a model");
        return model;
    }

    function edit(model: TextFileModel, text: string): void {
        model.applyExternalEdits([createTextEdit(createRange(0, 0, 0, 0), text)], "edit");
    }

    const heldPaths = () =>
        service()
            .getFileModelsWithoutEditor()
            .map((model) => model.uri.fsPath);

    it("opens a file, refuses a directory, a missing path and a foreign scheme", async () => {
        expect(await service().openTextDocumentWithoutEditor(Uri.file(ws.path("a.txt")))).toBe(true);
        expect(heldPaths()).toEqual([ws.path("a.txt")]);

        expect(await service().openTextDocumentWithoutEditor(Uri.file(ws.path("dir")))).toBe(false);
        expect(await service().openTextDocumentWithoutEditor(Uri.file(ws.path("missing")))).toBe(false);
        expect(await service().openTextDocumentWithoutEditor(Uri.parse("git:/a.txt"))).toBe(false);
        expect(service().holdFileModel(Uri.parse("git:/a.txt"))).toBeNull();
        expect(heldPaths()).toEqual([ws.path("a.txt")]);
    });

    it("holding fires onDidChangeEditors: the document sync reconciles on it", () => {
        let events = 0;
        service().onDidChangeEditors(() => events++);
        hold("a.txt");
        expect(events).toBe(1);
    });

    it("the tab opened later shares the model and its unsaved edit", () => {
        const model = hold("a.txt");
        edit(model, "X");

        h.workbench.openFile(ws.path("a.txt"));

        const pane = service()
            .getEditors()
            .find((editor) => editor.uri.fsPath === ws.path("a.txt"));
        expect(pane?.model).toBe(model);
        expect(pane?.getText()).toBe("Xa");
    });

    it("a move carries unsaved edits, a clean model is let go, the parent's children move too", async () => {
        const dirty = hold("dir/b.txt");
        edit(dirty, "X");
        hold("a.txt");

        await files().move(Uri.file(ws.path("dir")), Uri.file(ws.path("moved")), false);
        await files().move(Uri.file(ws.path("a.txt")), Uri.file(ws.path("c.txt")), false);

        expect(heldPaths()).toEqual([ws.path("moved/b.txt")]);
        const moved = service().getFileModelsWithoutEditor()[0];
        expect(moved.getText()).toBe("Xb");
        expect(moved.isModified).toBe(true);
    });

    it("a move of something else fires nothing", async () => {
        hold("a.txt");
        let events = 0;
        service().onDidChangeEditors(() => events++);

        await files().move(Uri.file(ws.path("dir")), Uri.file(ws.path("moved")), false);
        await files().del(Uri.file(ws.path("moved")), { recursive: true });

        expect(events).toBe(0);
        expect(heldPaths()).toEqual([ws.path("a.txt")]);
    });

    it("a held model's move and release are news for the document sync", async () => {
        hold("a.txt");
        let events = 0;
        service().onDidChangeEditors(() => events++);

        await files().move(Uri.file(ws.path("a.txt")), Uri.file(ws.path("moved.txt")), false);

        expect(events).toBe(1);
        expect(heldPaths()).toEqual([]);
    });

    it("a delete that lets a model go is news; one that keeps a dirty model isn't", async () => {
        hold("a.txt");
        edit(hold("dir/b.txt"), "X");
        let events = 0;
        service().onDidChangeEditors(() => events++);

        await files().del(Uri.file(ws.path("dir/b.txt")));
        expect(events).toBe(0);

        await files().del(Uri.file(ws.path("a.txt")));
        expect(events).toBe(1);
    });

    it("revertSoftBeforeDelete: the held model and a tab's under the resource lose their dirty state, others keep it", () => {
        const under = hold("dir/b.txt");
        const other = hold("a.txt");
        edit(under, "X");
        edit(other, "Y");
        h.workbench.openFile(ws.path("dir/b.txt"));

        service().revertSoftBeforeDelete(Uri.file(ws.path("dir")));

        expect(under.isModified).toBe(false);
        expect(under.getText()).toBe("Xb");
        expect(other.isModified).toBe(true);
    });

    it("revertSoftBeforeDelete skips a tab without a file: it has nothing to revert", () => {
        const dirty = hold("a.txt");
        edit(dirty, "X");
        service().openPane(service().openDetached(Uri.parse("output:log"), "log"));

        service().revertSoftBeforeDelete(Uri.file(ws.path("a.txt")));

        expect(dirty.isModified).toBe(false);
    });

    it("a soft revert repaints the views of the model: the dirty marker goes away", () => {
        const model = hold("a.txt");
        edit(model, "X");
        let repainted = 0;
        model.attachEditTarget({
            cloneSelections: () => [],
            applyEdits: () => undefined,
            markDirty: () => {
                repainted++;
            },
        });

        model.revertSoft();

        expect(repainted).toBe(1);
    });

    it("a model let go by its age is news for the document sync", () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        try {
            hold("a.txt");
            let events = 0;
            service().onDidChangeEditors(() => events++);

            vi.advanceTimersByTime(3 * 60 * 1000);

            expect(heldPaths()).toEqual([]);
            expect(events).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("a foreign scheme isn't looked up: a provider's file isn't held", async () => {
        const stat = vi.spyOn(files(), "stat");
        await expect(service().openTextDocumentWithoutEditor(Uri.parse("rw:/a.txt"))).resolves.toBe(false);
        expect(stat).not.toHaveBeenCalled();
    });

    it("the exit confirmation's save overwrites what changed on disk: the user was asked already", async () => {
        const model = hold("a.txt");
        edit(model, "X");
        const save = vi.spyOn(model, "save");
        const [item] = service().collectDirty();
        await item.save();
        expect(save).toHaveBeenCalledExactlyOnceWith({ overwrite: true });
    });

    it("a delete lets a clean model go; a dirty one stays, its edits exist nowhere else", async () => {
        hold("a.txt");
        edit(hold("dir/b.txt"), "X");

        await files().del(Uri.file(ws.path("a.txt")));
        await files().del(Uri.file(ws.path("dir/b.txt")));

        expect(heldPaths()).toEqual([ws.path("dir/b.txt")]);
    });

    it("saveAll and save reach a model without a tab; save writes a clean one too", async () => {
        const model = hold("a.txt");
        edit(model, "X");

        expect(await service().saveAll()).toBe(true);
        expect(fs.readFileSync(ws.path("a.txt"), "utf8")).toBe("Xa");
        expect(model.isModified).toBe(false);

        expect((await service().save(Uri.file(ws.path("a.txt"))))?.fsPath).toBe(ws.path("a.txt"));
        expect(await service().save(Uri.file(ws.path("dir/b.txt")))).toBeUndefined();
    });

    it("a failed save of a model without a tab makes saveAll false and keeps it dirty", async () => {
        const model = hold("a.txt");
        edit(model, "X");
        fs.rmSync(ws.path("a.txt"));
        fs.mkdirSync(ws.path("a.txt"));

        expect(await service().saveAll()).toBe(false);
        expect(model.isModified).toBe(true);
    });

    it("the exit confirmation lists a dirty model once, and not one a tab already speaks for", async () => {
        const model = hold("a.txt");
        edit(model, "X");
        expect(
            service()
                .collectDirty()
                .map((item) => item.name),
        ).toEqual(["a.txt"]);

        const [item] = service().collectDirty();
        expect(item.isStillDirty()).toBe(true);
        expect(await item.save()).toBe(true);
        expect(item.isStillDirty()).toBe(false);
        expect(service().collectDirty()).toEqual([]);

        edit(model, "Y");
        h.workbench.openFile(ws.path("a.txt"));
        expect(service().collectDirty()).toHaveLength(1);
    });

    it("Don't Save on the last tab lets go of the held model: the refused edits don't come back", async () => {
        const model = hold("a.txt");
        edit(model, "X");
        h.workbench.openFile(ws.path("a.txt"));
        const group = service().editorGroups.activeGroup;
        const dialogs = h.container.get(DialogServiceDIToken);

        const closed = service().closeEditor(group, 0);
        await settle();
        dialogs.getOpenConfirmSaveDialog()?.onDontSave?.();
        expect(await closed).toBe(true);

        expect(heldPaths()).toEqual([]);
        expect(service().textFileModels.get(Uri.file(ws.path("a.txt")))).toBeNull();
    });

    it("Don't Save lets go of that tab's model only", async () => {
        edit(hold("a.txt"), "Y");
        const model = hold("dir/b.txt");
        edit(model, "X");
        h.workbench.openFile(ws.path("dir/b.txt"));
        const dialogs = h.container.get(DialogServiceDIToken);

        const closed = service().closeEditor(service().editorGroups.activeGroup, 0);
        await settle();
        dialogs.getOpenConfirmSaveDialog()?.onDontSave?.();
        expect(await closed).toBe(true);

        expect(heldPaths()).toEqual([ws.path("a.txt")]);
    });

    it("Save on the last tab keeps the held model, now clean", async () => {
        const model = hold("a.txt");
        edit(model, "X");
        h.workbench.openFile(ws.path("a.txt"));
        const dialogs = h.container.get(DialogServiceDIToken);

        const closed = service().closeEditor(service().editorGroups.activeGroup, 0);
        await settle();
        dialogs.getOpenConfirmSaveDialog()?.onSave?.();
        expect(await closed).toBe(true);

        expect(heldPaths()).toEqual([ws.path("a.txt")]);
        expect(model.isModified).toBe(false);
    });
});
