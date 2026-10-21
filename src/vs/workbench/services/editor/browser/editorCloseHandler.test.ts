import { readFileSync } from "node:fs";

import { Size } from "@tuidom/core/common/geometryPromitives";
import type { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { DialogServiceDIToken } from "../../dialogs/browser/dialogService.ts";
import { EditorServiceDIToken } from "../common/editorService.ts";

import type { EditorGroup } from "./editorGroupModel.ts";

describe("EditorService.closeEditor (confirm on close)", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-close-editor-",
            files: { "a.txt": "a", "b.txt": "b", "c.txt": "c" },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(120, 30) });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const service = () => h.container.get(EditorServiceDIToken);
    const dialogs = () => h.container.get(DialogServiceDIToken);
    const group = (): EditorGroup => service().editorGroups.activeGroup;
    const labels = (target: EditorGroup = group()): string[] => target.getPanes().map((pane) => pane.label);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    function openAll(...names: string[]): void {
        for (const name of names) h.workbench.openFile(ws.path(name));
    }

    function edit(pane: IEditorPane, text: string): void {
        (pane as unknown as { viewState: { type(text: string): unknown } }).viewState.type(text);
    }

    const paneAt = (index: number): IEditorPane => group().getPanes()[index];

    it("closes a clean tab immediately, without a dialog or awaiting a promise", async () => {
        openAll("a.txt", "b.txt");

        const closed = service().closeEditor(group(), 0);

        expect(labels()).toEqual(["b.txt"]);
        expect(dialogs().getOpenConfirmSaveDialog()).toBeNull();
        expect(await closed).toBe(true);
    });

    it("a position outside the strip: nothing to close, returns true", async () => {
        openAll("a.txt");

        expect(await service().closeEditor(group(), 5)).toBe(true);
        expect(labels()).toEqual(["a.txt"]);
    });

    it("reveals the tab it asks about before asking; Cancel vetoes", async () => {
        openAll("a.txt", "b.txt");
        const dirty = paneAt(0);
        edit(dirty, "X");
        expect(group().activeIndex).toBe(1);

        const closed = service().closeEditor(group(), dirty);
        await settle();

        expect(group().activePane).toBe(dirty);
        const dialog = dialogs().getOpenConfirmSaveDialog();
        expect(dialog).not.toBeNull();
        dialog?.onCancel?.();

        expect(await closed).toBe(false);
        expect(labels()).toEqual(["a.txt", "b.txt"]);
    });

    it("Don't Save closes the tab and leaves the file alone", async () => {
        openAll("a.txt");
        edit(paneAt(0), "X");

        const closed = service().closeEditor(group(), 0);
        await settle();
        dialogs().getOpenConfirmSaveDialog()?.onDontSave?.();

        expect(await closed).toBe(true);
        expect(labels()).toEqual([]);
        expect(readFileSync(ws.path("a.txt"), "utf8")).toBe("a");
    });

    it("Save writes the file and closes the tab", async () => {
        openAll("a.txt");
        edit(paneAt(0), "X");

        const closed = service().closeEditor(group(), paneAt(0));
        await settle();
        dialogs().getOpenConfirmSaveDialog()?.onSave?.();

        expect(await closed).toBe(true);
        expect(labels()).toEqual([]);
        expect(readFileSync(ws.path("a.txt"), "utf8")).toBe("Xa");
    });

    it("a Save that did not save (untitled without a path) vetoes: the tab and text stay", async () => {
        service().newUntitled();
        const untitled = paneAt(0);
        edit(untitled, "keepme");

        const closed = service().closeEditor(group(), untitled);
        await settle();
        dialogs().getOpenConfirmSaveDialog()?.onSave?.();

        expect(await closed).toBe(false);
        expect(group().getPanes()).toEqual([untitled]);
        expect(untitled.isModified).toBe(true);
    });

    it("a diff of two dirty untitled sides: the dialog names both, Save without a path vetoes", async () => {
        h.commands.execute("workbench.files.action.compareNewUntitledTextFiles");
        await vi.waitFor(() => {
            expect(group().activePane instanceof DiffEditorPane2).toBe(true);
        });
        const diff = group().activePane as DiffEditorPane2;
        for (const side of diff.sidePanes()) edit(side, "dirty");

        const closed = service().closeEditor(group(), diff);
        await settle();
        const dialog = h.testApp.querySelector("#confirmSaveDialog");
        const text = (dialog?.querySelectorAll("TextLabelElement") ?? [])
            .map((label) => (label as TextLabelElement).getText())
            .join("\n");
        expect(text).toContain("Untitled-1, Untitled-2");
        dialogs().getOpenConfirmSaveDialog()?.onSave?.();

        expect(await closed).toBe(false);
        expect(group().getPanes()).toContain(diff);
    });

    it("closes a tab of another kind (Keyboard Shortcuts) without a dialog", async () => {
        openAll("a.txt");
        h.commands.execute("workbench.action.openGlobalKeybindings");
        expect(labels()).toHaveLength(2);

        expect(await service().closeEditor(group(), group().activePane!)).toBe(true);

        expect(dialogs().getOpenConfirmSaveDialog()).toBeNull();
        expect(labels()).toEqual(["a.txt"]);
    });

    it("document visible in another group: the dirty tab closes without a dialog", async () => {
        openAll("a.txt");
        edit(paneAt(0), "X");
        h.commands.execute("workbench.action.splitEditor");
        const [first, second] = service().editorGroups.groups;

        expect(await service().closeEditor(first, 0)).toBe(true);

        expect(dialogs().getOpenConfirmSaveDialog()).toBeNull();
        expect(labels(first)).toEqual([]);
        expect(second.getPanes()[0].isModified).toBe(true);
    });

    it("a repeated request for a tab while its dialog is open joins that dialog", async () => {
        openAll("a.txt", "b.txt");
        const dirty = paneAt(1);
        edit(dirty, "X");

        const first = service().closeEditor(group(), dirty);
        await settle();
        const dialog = dialogs().getOpenConfirmSaveDialog();
        const second = service().closeEditor(group(), dirty);
        await settle();

        // No second dialog was opened: the answer to the first resolves both requests.
        expect(dialogs().getOpenConfirmSaveDialog()).toBe(dialog);
        dialog?.onDontSave?.();

        expect(await first).toBe(true);
        expect(await second).toBe(true);
        expect(labels()).toEqual(["a.txt"]);
    });

    it("after a veto a repeated request asks again", async () => {
        openAll("a.txt");
        edit(paneAt(0), "X");

        const first = service().closeEditor(group(), 0);
        await settle();
        dialogs().getOpenConfirmSaveDialog()?.onCancel?.();
        expect(await first).toBe(false);

        const second = service().closeEditor(group(), 0);
        await settle();
        expect(dialogs().getOpenConfirmSaveDialog()).not.toBeNull();
        dialogs().getOpenConfirmSaveDialog()?.onDontSave?.();
        expect(await second).toBe(true);
        expect(labels()).toEqual([]);
    });

    it("the tab closed while the dialog was open: Don't Save does not close another one", async () => {
        openAll("a.txt", "b.txt");
        const dirty = paneAt(0);
        edit(dirty, "X");

        const closed = service().closeEditor(group(), dirty);
        await settle();
        group().closeTab(group().getPanes().indexOf(dirty));
        dialogs().getOpenConfirmSaveDialog()?.onDontSave?.();

        expect(await closed).toBe(true);
        expect(labels()).toEqual(["b.txt"]);
    });

    it("closeAllEditors goes from the tail; Cancel stops the run at a dirty tab", async () => {
        openAll("a.txt", "b.txt", "c.txt");
        edit(paneAt(1), "X");

        const closed = service().closeAllEditors(group());
        await settle();
        // c.txt closed before the question about b.txt, a.txt was never reached.
        expect(labels()).toEqual(["a.txt", "b.txt"]);
        dialogs().getOpenConfirmSaveDialog()?.onCancel?.();

        expect(await closed).toBe(false);
        expect(labels()).toEqual(["a.txt", "b.txt"]);
    });

    it("closeEditors closes in the caller's order and returns true if all are closed", async () => {
        openAll("a.txt", "b.txt", "c.txt");
        edit(paneAt(2), "X");
        const [a, , c] = group().getPanes();

        const closed = service().closeEditors(group(), [a, c]);
        // a closed immediately, c awaits an answer.
        expect(labels()).toEqual(["b.txt", "c.txt"]);
        await settle();
        dialogs().getOpenConfirmSaveDialog()?.onDontSave?.();

        expect(await closed).toBe(true);
        expect(labels()).toEqual(["b.txt"]);
    });
});
