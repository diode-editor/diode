import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { createAppTestHarness, type IAppHarness } from "../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { DialogServiceDIToken } from "../../services/dialogs/browser/dialogService.ts";
import type { EditorGroup } from "../../services/editor/browser/editorGroupModel.ts";
import { EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";

/**
 * Команды закрытия из контекст-меню вкладки. Цель приходит адресом
 * `(groupId, index)` — правый клик активную вкладку не меняет, поэтому тесты
 * проверяют именно адресную работу, а не «по активной».
 */
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
    const group = (): EditorGroup => service().activeGroup;
    const labels = (target: EditorGroup = group()): string[] => target.getPanes().map((pane) => pane.label);

    function openAll(...names: string[]): void {
        for (const name of names) h.workbench.openFile(ws.path(name));
    }

    /** Ждёт, пока асинхронная серия закрытия (confirm-флоу) отработает. */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("Close Others закрывает всё, кроме адресованной вкладки", async () => {
        openAll("a.txt", "b.txt", "c.txt");
        // Активна c.txt (открыта последней), а адресуем b.txt.
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

    it("Close Saved оставляет изменённые вкладки", async () => {
        openAll("a.txt", "b.txt", "c.txt");
        const dirty = group().getPanes()[1] as { viewState: { type(text: string): unknown } };
        dirty.viewState.type("edited");

        h.commands.execute("workbench.action.closeUnmodifiedEditors", group().id, 0);
        await settle();

        expect(labels()).toEqual(["b.txt"]);
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

        // Cancel в первом же диалоге останавливает всю серию: c.txt осталась, а
        // до чистой a.txt очередь не дошла.
        expect(labels()).toEqual(["a.txt", "b.txt", "c.txt"]);
    });

    it("адресованная команда работает по чужой группе, не трогая активную", async () => {
        openAll("a.txt");
        h.commands.execute("workbench.action.splitEditor");
        openAll("b.txt", "c.txt");
        const [first, second] = service().groups;
        expect(service().activeGroup === second).toBe(true);
        expect(labels(second)).toEqual(["a.txt", "b.txt", "c.txt"]);

        // Меню открыли на единственной вкладке ПЕРВОЙ группы.
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
            expect(service().groups.length).toBe(2);
        });

        // Сплит унёс в новую группу именно a.txt — вкладку, по которой открыли меню.
        expect(labels(service().groups[1])).toEqual(["a.txt"]);
    });
});
