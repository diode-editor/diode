import * as fs from "node:fs";

import type { EditorTabStripElement } from "@tuidom/elements/editorgroup/editorTabStripElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { fileDialogDriver } from "../../../TestUtils/fileDialogDriver.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../base/common/uri.ts";
import { DialogServiceDIToken } from "../services/dialogs/browser/dialogService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

/** A buffer named by an extension (`openTextDocument(untitled:…)`), then shown and saved like any tab. */
describe("Workbench — untitled buffer under a resource", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-untitled-resource-", files: { "taken.txt": "theirs" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const service = () => h.container.get(EditorServiceDIToken);

    async function show(uri: string): Promise<void> {
        const resource = Uri.parse(uri);
        await service().openUntitledDocument(resource);
        await service().openUri(resource);
        h.testApp.render();
    }

    function tabLabels(): string[] {
        const strip = h.testApp.querySelector("EditorTabStripElement") as EditorTabStripElement;
        return strip.getItemElements().map((element) => element.getLabel());
    }

    it("the tab is named by the basename and carries the dirty marker from the start", async () => {
        await show(`untitled:${ws.path("deep/new.txt")}`);

        expect(tabLabels()).toEqual([expect.stringContaining("new.txt")]);
        expect(tabLabels()[0]).not.toContain("deep");
        expect(service().getActiveEditor()?.isModified).toBe(true);
    });

    it("Ctrl+S with an absolute path writes without a dialog, the tab becomes the file", async () => {
        const target = ws.path("deep/new.txt");
        await show(`untitled:${target}`);

        await h.commands.execute("workbench.action.files.save");

        expect(fs.readFileSync(target, "utf8")).toBe("");
        const editor = service().getActiveEditor();
        expect(editor?.uri.toString()).toBe(Uri.file(target).toString());
        expect(editor?.isModified).toBe(false);
    });

    it("Ctrl+S with a relative uri asks where: the dialog offers the name, the tab becomes the file", async () => {
        await show("untitled:new.txt");
        service()
            .getActiveEditor()
            ?.applyExternalEdits(
                [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "typed" }],
                "typed",
            );
        expect(service().getActiveEditor()?.isModified).toBe(true);

        const dialog = fileDialogDriver(h);
        void h.commands.execute("workbench.action.files.save");
        const seed = ws.path("new.txt");
        await dialog.settle({ title: "Save As", query: seed });
        dialog.key("Enter");

        await vi.waitFor(() => {
            expect(fs.readFileSync(seed, "utf8")).toBe("typed");
        });
        await vi.waitFor(() => {
            h.testApp.render();
            expect(service().getActiveEditor()?.uri.toString()).toBe(Uri.file(seed).toString());
            expect(service().getActiveEditor()?.isModified).toBe(false);
        });
    });

    it("a file that appeared after the open: Ctrl+S asks before overwriting, Cancel leaves it alone", async () => {
        const target = ws.path("late.txt");
        await show(`untitled:${target}`);
        fs.writeFileSync(target, "theirs");

        await h.commands.execute("workbench.action.files.save");

        expect(h.container.get(DialogServiceDIToken).getOpenConfirmDialog()).not.toBeNull();
        expect(fs.readFileSync(target, "utf8")).toBe("theirs");
        expect(service().getActiveEditor()?.uri.scheme).toBe("untitled");
    });

    it("a failed write leaves the buffer untitled and dirty, not bound to a file that does not exist", async () => {
        // A regular file in place of the parent directory: neither the folder nor the file can be created.
        const uri = `untitled:${ws.path("taken.txt/new.txt")}`;
        await show(uri);

        expect(await service().save(Uri.parse(uri))).toBeUndefined();

        const editor = service().getActiveEditor();
        expect(editor?.uri.toString()).toBe(Uri.parse(uri).toString());
        expect(editor?.isModified).toBe(true);
    });

    it("Save As on a buffer with a path replaces it with the chosen file", async () => {
        await show(`untitled:${ws.path("first.txt")}`);
        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.saveAs");
        await dialog.settle({ title: "Save As", query: ws.path("first.txt") });
        const chosen = ws.path("second.txt");
        dialog.replaceQuery(chosen);
        await dialog.settle({ query: chosen });
        dialog.key("Enter");

        await vi.waitFor(() => {
            expect(fs.existsSync(chosen)).toBe(true);
            expect(service().getActiveEditor()?.isModified).toBe(false);
        });
        expect(fs.existsSync(ws.path("first.txt"))).toBe(false);
    });

    it("a repeated open with the same uri reuses the tab's model, another encoding applies to it", async () => {
        const uri = `untitled:${ws.path("again.txt")}`;
        await show(uri);
        await service().openUntitledDocument(Uri.parse(uri), { encoding: "windows1252" });

        expect(service().getActiveEditor()?.encoding).toBe("windows1252");
        expect(tabLabels()).toHaveLength(1);
    });

    it("a resource with a host or a relative one is not checked against the disk; an empty one is refused", async () => {
        const taken = ws.path("taken.txt");
        await expect(service().openUntitledDocument(Uri.parse(`untitled://localhost${taken}`))).resolves.toBeDefined();
        await expect(service().openUntitledDocument(Uri.parse(`untitled:${taken.slice(1)}`))).resolves.toBeDefined();
        await expect(service().openUntitledDocument(Uri.parse("untitled://localhost"))).resolves.toBeDefined();
        await expect(service().openUntitledDocument(Uri.parse("untitled:"))).rejects.toThrow(/Invalid uri/);
    });

    it("a new document over an existing file is refused, an already open one is not checked again", async () => {
        const late = ws.path("late.txt");
        await expect(service().openUntitledDocument(Uri.parse(`untitled:${ws.path("taken.txt")}`))).rejects.toThrow(
            /file already exists/,
        );

        const uri = Uri.parse(`untitled:${late}`);
        await service().openUntitledDocument(uri);
        fs.writeFileSync(late, "theirs");

        await expect(service().openUntitledDocument(uri)).resolves.toBeDefined();
    });

    it("createUntitled under a resource: not associated by default, and only an automatic name is marked dirty", () => {
        service().createUntitled({ uri: Uri.parse("untitled:plain.txt") });
        service().createUntitled();

        const [named, automatic] = service().getUntitledModelsWithoutEditor();
        expect(named.isModified).toBe(false);
        expect(named.isDirtyForExtensions).toBe(false);
        expect(automatic.isDirtyForExtensions).toBe(true);
    });

    it("a document without a tab, saved: the file is written, the document and its model are over", async () => {
        const target = ws.path("no-tab.txt");
        const uri = Uri.parse(`untitled:${target}`);
        await service().openUntitledDocument(uri);
        const [model] = service().getUntitledModelsWithoutEditor();
        const dispose = vi.spyOn(model, "dispose");
        const seen: number[] = [];
        service().onDidChangeEditors(() => seen.push(service().getUntitledModelsWithoutEditor().length));

        expect((await service().save(uri))?.toString()).toBe(Uri.file(target).toString());

        expect(fs.existsSync(target)).toBe(true);
        expect(seen.at(-1)).toBe(0);
        expect(dispose).toHaveBeenCalledOnce();
    });

    it("tabs of one document in two groups share the model: it dies with the last of them", async () => {
        const uri = service().createUntitled({ uri: Uri.parse("untitled:shared.txt") });
        await service().openUri(uri);
        const first = service().getActiveEditor();
        if (first === null) throw new Error("no editor");
        const dispose = vi.spyOn(first.model, "dispose");
        await service().openUri(uri, { group: "beside" });
        const [one, two] = service().editorGroups.groups;

        await service().closeEditor(two, 0);
        expect(dispose).not.toHaveBeenCalled();

        await service().closeEditor(one, 0);
        expect(dispose).toHaveBeenCalledOnce();
    });

    it("the active editor changes for extensions only when a save changed its resource", async () => {
        const target = ws.path("active.txt");
        await show(`untitled:${target}`);
        service().openFile(ws.path("taken.txt"));
        const seen: (string | undefined)[] = [];
        service().onActiveEditorChanged((editor) => seen.push(editor?.uri.toString()));

        // In the background: the buffer is not the active editor, however its resource changed.
        await service().save(Uri.parse(`untitled:${target}`));
        expect(seen).toEqual([]);

        const active = service().getActiveEditor();
        active?.applyExternalEdits(
            [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "x" }],
            "typed",
        );
        await service().save(Uri.file(ws.path("taken.txt")));
        expect(seen).toEqual([]);

        const shown = ws.path("shown.txt");
        await show(`untitled:${shown}`);
        seen.length = 0;
        await service().save(Uri.parse(`untitled:${shown}`));
        expect(seen).toEqual([Uri.file(shown).toString()]);
    });

    it("a file emptied by an edit stays modified: only an untitled buffer turns clean", () => {
        service().openFile(ws.path("taken.txt"));
        const editor = service().getActiveEditor();

        editor?.applyExternalEdits(
            [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } }, text: "" }],
            "emptied",
        );

        expect(editor?.getText()).toBe("");
        expect(editor?.isModified).toBe(true);
    });
});
