import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { DialogServiceDIToken } from "../../services/dialogs/browser/dialogService.ts";
import type { EditorGroup } from "../../services/editor/browser/editorGroupModel.ts";
import { EditorServiceDIToken } from "../../services/editor/common/editorService.ts";

describe("Tab close actions", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-tab-close-",
            files: { "a.txt": "a", "b.txt": "b", "c.txt": "c", "d.txt": "d" },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(120, 30) });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const service = () => h.container.get(EditorServiceDIToken);
    const group = (): EditorGroup => service().editorGroups.activeGroup;
    const labels = (target: EditorGroup = group()): string[] => target.getPanes().map((pane) => pane.label);

    function openAll(...names: string[]): void {
        for (const name of names) h.workbench.openFile(ws.path(name));
    }

    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("Close Others закрывает всё, кроме адресованной вкладки", async () => {
        openAll("a.txt", "b.txt", "c.txt");
        // c.txt is active (opened last), while we address b.txt.
        expect(group().activeIndex).toBe(2);

        h.commands.execute("workbench.action.closeOtherEditors", group().id, 1);
        await settle();

        expect(labels()).toEqual(["b.txt"]);
    });

    it("Close to the Right закрывает только правый хвост", async () => {
        openAll("a.txt", "b.txt", "c.txt", "d.txt");

        h.commands.execute("workbench.action.closeEditorsToTheRight", group().id, 1);
        await settle();

        expect(labels()).toEqual(["a.txt", "b.txt"]);
    });

    it("Close to the Right закрывает с дальнего края — Cancel оставляет хвост до грязной", async () => {
        openAll("a.txt", "b.txt", "c.txt", "d.txt");
        const dirty = group().getPanes()[1] as { viewState: { type(text: string): unknown } };
        dirty.viewState.type("edited");

        // Address a.txt: to its right are b (dirty), c and d.
        h.commands.execute("workbench.action.closeEditorsToTheRight", group().id, 0);
        await settle();
        const dialogs = h.container.get(DialogServiceDIToken);
        dialogs.getOpenConfirmSaveDialog()?.onCancel?.();
        await settle();

        // Going from the far end, d and c close before the prompt about b, and Cancel
        // stops the series there. A left-to-right walk would hit the dialog on the
        // very first step and leave c and d open.
        expect(labels()).toEqual(["a.txt", "b.txt"]);
    });

    it("Close Saved оставляет изменённые вкладки", async () => {
        openAll("a.txt", "b.txt", "c.txt");
        const dirty = group().getPanes()[1] as { viewState: { type(text: string): unknown } };
        dirty.viewState.type("edited");

        h.commands.execute("workbench.action.closeUnmodifiedEditors", group().id, 0);
        await settle();

        expect(labels()).toEqual(["b.txt"]);
        expect(h.container.get(DialogServiceDIToken).getOpenConfirmSaveDialog()).toBeNull();
    });

    it("Close Others спрашивает про несохранённую вкладку, Cancel прерывает серию", async () => {
        openAll("a.txt", "b.txt", "c.txt");
        const dirty = group().getPanes()[2] as { viewState: { type(text: string): unknown } };
        dirty.viewState.type("edited");

        h.commands.execute("workbench.action.closeOtherEditors", group().id, 1);
        await settle();

        const dialogs = h.container.get(DialogServiceDIToken);
        const dialog = dialogs.getOpenConfirmSaveDialog();
        expect(dialog).not.toBeNull();

        dialog?.onCancel?.();
        await settle();

        // Cancel in the very first dialog stops the whole series: c.txt stays, and
        // the clean a.txt is never reached.
        expect(labels()).toEqual(["a.txt", "b.txt", "c.txt"]);
    });

    it("Close Others: Save по untitled без пути не закрывает вкладку — текст не теряется", async () => {
        openAll("a.txt");
        service().newUntitled();
        const untitled = group().getPanes()[1] as unknown as { viewState: { type(text: string): unknown } };
        untitled.viewState.type("keepme");

        h.commands.execute("workbench.action.closeOtherEditors", group().id, 0);
        await settle();
        h.container.get(DialogServiceDIToken).getOpenConfirmSaveDialog()?.onSave?.();
        await settle();

        // Nowhere to save ("no-file") is a veto, as with Ctrl+W: the tab with its text survives.
        expect(labels()).toEqual(["a.txt", "Untitled-1"]);
        expect(group().getPanes()[1].isModified).toBe(true);
    });

    it("адресованная команда работает по чужой группе, не трогая активную", async () => {
        openAll("a.txt");
        h.commands.execute("workbench.action.splitEditor");
        openAll("b.txt", "c.txt");
        const [first, second] = service().editorGroups.groups;
        expect(service().editorGroups.activeGroup === second).toBe(true);
        expect(labels(second)).toEqual(["a.txt", "b.txt", "c.txt"]);

        h.commands.execute("workbench.action.closeEditorsToTheRight", second.id, 0);
        await settle();

        expect(labels(second)).toEqual(["a.txt"]);
        expect(labels(first)).toEqual(["a.txt"]);
    });

    it("без аргументов команды работают по активной вкладке (палитра)", async () => {
        openAll("a.txt", "b.txt", "c.txt");

        h.commands.execute("workbench.action.closeOtherEditors");
        await settle();

        expect(labels()).toEqual(["c.txt"]);
    });

    it("одно число адресом не считается — команда идёт по активной вкладке", async () => {
        openAll("a.txt", "b.txt", "c.txt"); // c.txt is active

        // A single number cannot be an address: otherwise the command would find no tab and silently do nothing.
        h.commands.execute("workbench.action.closeOtherEditors", 1);
        await settle();

        expect(labels()).toEqual(["c.txt"]);
    });

    it("пункты не выполняются по протухшему адресу", async () => {
        openAll("a.txt", "b.txt");

        h.commands.execute("workbench.action.closeOtherEditors", 9999, 0);
        h.commands.execute("workbench.action.closeEditorsToTheRight", group().id, 42);
        h.commands.execute("workbench.action.closeUnmodifiedEditors", 9999, 0);
        await settle();

        expect(labels()).toEqual(["a.txt", "b.txt"]);
    });

    it("Split Right по адресу сплитит вкладку под курсором, а не активную", async () => {
        openAll("a.txt", "b.txt", "c.txt");

        h.commands.execute("workbench.action.splitEditorRight", group().id, 0);
        await vi.waitFor(() => {
            expect(service().editorGroups.groups.length).toBe(2);
        });

        // The split moved exactly a.txt, the tab the menu was opened on, into the new group.
        expect(labels(service().editorGroups.groups[1])).toEqual(["a.txt"]);
    });
});
