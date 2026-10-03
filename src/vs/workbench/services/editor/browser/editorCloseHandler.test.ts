import { readFileSync } from "node:fs";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { DialogServiceDIToken } from "../../dialogs/browser/dialogService.ts";

import type { EditorGroup } from "./editorGroupModel.ts";
import { EditorServiceDIToken } from "./editorService.ts";

/**
 * Закрытие вкладок с подтверждением — единая точка `EditorService.closeEditor`
 * / `closeEditors` / `closeAllEditors`. Смотрим на то, что видит человек:
 * открыт ли диалог, какие вкладки остались, что легло на диск.
 */
describe("EditorService.closeEditor (confirm на закрытии)", () => {
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
    const group = (): EditorGroup => service().activeGroup;
    const labels = (target: EditorGroup = group()): string[] => target.getPanes().map((pane) => pane.label);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    function openAll(...names: string[]): void {
        for (const name of names) h.workbench.openFile(ws.path(name));
    }

    function edit(pane: IEditorPane, text: string): void {
        (pane as unknown as { viewState: { type(text: string): unknown } }).viewState.type(text);
    }

    const paneAt = (index: number): IEditorPane => group().getPanes()[index];

    it("чистую вкладку закрывает сразу, без диалога и без ожидания промиса", async () => {
        openAll("a.txt", "b.txt");

        const closed = service().closeEditor(group(), 0);

        expect(labels()).toEqual(["b.txt"]);
        expect(dialogs().getOpenConfirmSaveDialog()).toBeNull();
        expect(await closed).toBe(true);
    });

    it("позиция вне полосы — закрывать нечего, ответ true", async () => {
        openAll("a.txt");

        expect(await service().closeEditor(group(), 5)).toBe(true);
        expect(labels()).toEqual(["a.txt"]);
    });

    it("перед вопросом показывает вкладку, про которую спрашивает; Cancel — вето", async () => {
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

    it("Don't Save закрывает вкладку, файл не трогает", async () => {
        openAll("a.txt");
        edit(paneAt(0), "X");

        const closed = service().closeEditor(group(), 0);
        await settle();
        dialogs().getOpenConfirmSaveDialog()?.onDontSave?.();

        expect(await closed).toBe(true);
        expect(labels()).toEqual([]);
        expect(readFileSync(ws.path("a.txt"), "utf8")).toBe("a");
    });

    it("Save пишет файл и закрывает вкладку", async () => {
        openAll("a.txt");
        edit(paneAt(0), "X");

        const closed = service().closeEditor(group(), paneAt(0));
        await settle();
        dialogs().getOpenConfirmSaveDialog()?.onSave?.();

        expect(await closed).toBe(true);
        expect(labels()).toEqual([]);
        expect(readFileSync(ws.path("a.txt"), "utf8")).toBe("Xa");
    });

    it("Save, который не сохранил (untitled без пути), — вето: вкладка и текст остаются", async () => {
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

    it("документ виден в другой группе — грязная вкладка закрывается без диалога", async () => {
        openAll("a.txt");
        edit(paneAt(0), "X");
        h.commands.execute("workbench.action.splitEditor");
        const [first, second] = service().groups;

        expect(await service().closeEditor(first, 0)).toBe(true);

        expect(dialogs().getOpenConfirmSaveDialog()).toBeNull();
        expect(labels(first)).toEqual([]);
        expect(second.getPanes()[0].isModified).toBe(true);
    });

    it("повторный запрос по вкладке, пока её диалог открыт, присоединяется к нему", async () => {
        openAll("a.txt", "b.txt");
        const dirty = paneAt(1);
        edit(dirty, "X");

        const first = service().closeEditor(group(), dirty);
        await settle();
        const dialog = dialogs().getOpenConfirmSaveDialog();
        const second = service().closeEditor(group(), dirty);
        await settle();

        // Второй диалог не открывался: ответ на первый решает оба запроса.
        expect(dialogs().getOpenConfirmSaveDialog()).toBe(dialog);
        dialog?.onDontSave?.();

        expect(await first).toBe(true);
        expect(await second).toBe(true);
        // Закрыта ровно одна вкладка — повторный запрос не задел соседку.
        expect(labels()).toEqual(["a.txt"]);
    });

    it("после вето повторный запрос снова спрашивает", async () => {
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

    it("вкладку закрыли, пока шёл диалог, — Don't Save не закрывает чужую", async () => {
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

    it("closeAllEditors идёт с хвоста; Cancel обрывает серию на грязной", async () => {
        openAll("a.txt", "b.txt", "c.txt");
        edit(paneAt(1), "X");

        const closed = service().closeAllEditors(group());
        await settle();
        // c.txt закрылась до вопроса про b.txt, до a.txt очередь не дошла.
        expect(labels()).toEqual(["a.txt", "b.txt"]);
        dialogs().getOpenConfirmSaveDialog()?.onCancel?.();

        expect(await closed).toBe(false);
        expect(labels()).toEqual(["a.txt", "b.txt"]);
    });

    it("closeEditors закрывает в порядке вызывающего и отвечает true, если закрыты все", async () => {
        openAll("a.txt", "b.txt", "c.txt");
        edit(paneAt(2), "X");
        const [a, , c] = group().getPanes();

        const closed = service().closeEditors(group(), [a, c]);
        // a закрылась сразу, c ждёт ответа.
        expect(labels()).toEqual(["b.txt", "c.txt"]);
        await settle();
        dialogs().getOpenConfirmSaveDialog()?.onDontSave?.();

        expect(await closed).toBe(true);
        expect(labels()).toEqual(["b.txt"]);
    });
});
