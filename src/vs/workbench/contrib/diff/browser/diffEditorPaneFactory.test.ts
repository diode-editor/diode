import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import { EditorPaneFactoriesDIToken } from "../../../services/editor/browser/editorPaneFactory.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

import { DIFF_EDITOR_PANE_TYPE_ID } from "./diffEditorPaneFactory.ts";
import { type IOpenDiffPairOptions, openDiffPair } from "./openDiffPair.ts";

/**
 * Дифф-вкладка повторяется по рецепту — спекам сторон, по которым её открыло
 * ядро сравнения: сплит, копия в группу, рестор сессии.
 */
describe("Фабрика дифф-вкладки", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-diff-factory-", files: { "a.txt": "one\n", "b.txt": "two\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const service = () => h.container.get(EditorServiceDIToken);
    const factory = () => {
        const found = h.container.get(EditorPaneFactoriesDIToken).find((f) => f.typeId === DIFF_EDITOR_PANE_TYPE_ID);
        if (found === undefined) throw new Error("фабрики диффа нет в списке профиля");
        return found;
    };
    const files = (): IOpenDiffPairOptions => ({
        original: { uri: Uri.file(ws.path("a.txt")), label: "a.txt", identity: "a", preferDisk: true },
        modified: { uri: Uri.file(ws.path("b.txt")), label: "b.txt", identity: "b", onMissing: "empty" },
        title: "a ↔ b",
    });

    async function openFilesDiff(): Promise<DiffEditorPane2> {
        await openDiffPair(h.container, files());
        return service().getActiveTabPane() as DiffEditorPane2;
    }

    it("сплит повторяет дифф файлов в новой группе — стороны на тех же документах", async () => {
        const source = await openFilesDiff();

        const group = service().splitActiveGroup();
        await vi.waitFor(() => {
            expect(group?.editorCount).toBe(1);
        });

        const copy = group!.activePane as DiffEditorPane2;
        expect(copy).not.toBe(source);
        expect(copy.uri.toString()).toBe(source.uri.toString());
        expect(copy.label).toBe("a ↔ b");
        // modified-сторона — живая общая модель файла; original — снимок с диска.
        expect(copy.sidePanes()[1].model).toBe(source.sidePanes()[1].model);
    });

    it("копия в соседнюю группу — дифф там, источник на месте", async () => {
        await openFilesDiff();

        service().copyActiveEditorToGroup("next");
        await vi.waitFor(() => {
            expect(service().groups.at(1)?.editorCount).toBe(1);
        });

        expect(service().groups[0].editorCount).toBe(1);
        expect(service().groups[1].activePane instanceof DiffEditorPane2).toBe(true);
    });

    it("повтор в группу ищет вкладку только там: дифф в соседней группе не мешает", async () => {
        const source = await openFilesDiff();
        const right = service().newGroup("after", { focus: false })!;

        await openDiffPair(h.container, files(), { group: right, focus: false });

        expect(right.editorCount).toBe(1);
        expect(right.activePane).not.toBe(source);
        expect(service().groups[0].activePane).toBe(source);
    });

    it("повтор в группу, где дифф уже открыт, активирует его без фокуса", async () => {
        const source = await openFilesDiff();
        service().openFile(ws.path("a.txt"));

        await openDiffPair(h.container, files(), { group: service().activeGroup, focus: false });

        expect(service().activeGroup.editorCount).toBe(2);
        expect(service().activeGroup.activePane).toBe(source);
        // Фокус был во вкладке a.txt, она ушла из дерева; в дифф его не ставили.
        expect(h.testApp.focusedElement).toBeNull();
    });

    it("повтор в группу освежает снимок уже открытого там диффа", async () => {
        const clip = (text: string): IOpenDiffPairOptions => ({
            ...files(),
            original: { text, label: "Clipboard", identity: "clip" },
        });
        await openDiffPair(h.container, clip("old"));
        const pane = service().getActiveTabPane() as DiffEditorPane2;
        const right = service().newGroup("after", { focus: false })!;

        await openDiffPair(h.container, clip("new"), { group: service().groups[0], focus: false });

        // Та же вкладка, свежий текст; активная группа не сменилась.
        expect(service().groups[0].editorCount).toBe(1);
        expect(pane.sidePanes()[0].getText()).toBe("new");
        expect(service().activeGroup).toBe(right);
    });

    it("команда сравнения находит дифф в другой группе и делает её активной", async () => {
        const source = await openFilesDiff();
        service().newGroup("after");
        service().openFile(ws.path("a.txt"));
        const focusedBefore = h.testApp.focusedElement;

        await openDiffPair(h.container, files());

        expect(service().groups.length).toBe(2);
        expect(service().activeGroup).toBe(service().groups[0]);
        expect(service().getActiveTabPane()).toBe(source);
        // Фокус уехал в дифф — команда сравнения его показывает, а не только активирует.
        expect(h.testApp.focusedElement).not.toBeNull();
        expect(h.testApp.focusedElement).not.toBe(focusedBefore);
    });

    it("дифф со стороной-моделью слева не повторить", async () => {
        const owned = service().createUntitledModel();
        await openDiffPair(h.container, {
            original: { ownedModel: owned, label: "Untitled", identity: "u" },
            modified: { uri: Uri.file(ws.path("a.txt")), label: "a.txt", identity: "a" },
        });
        const pane = service().getActiveTabPane() as DiffEditorPane2;

        expect(factory().describe(pane)).toBeUndefined();
    });

    it("дифф со стороной-моделью справа не повторить", async () => {
        const owned = service().createUntitledModel();
        await openDiffPair(h.container, {
            original: { uri: Uri.file(ws.path("a.txt")), label: "a.txt", identity: "a" },
            modified: { ownedModel: owned, label: "Untitled", identity: "u" },
        });
        const pane = service().getActiveTabPane() as DiffEditorPane2;

        expect(factory().describe(pane)).toBeUndefined();
    });

    it("untitled-пару не повторить: её стороны принадлежат одной панели", async () => {
        h.commands.execute("workbench.files.action.compareNewUntitledTextFiles");
        await vi.waitFor(() => {
            expect(service().getActiveTabPane() instanceof DiffEditorPane2).toBe(true);
        });

        const group = service().splitActiveGroup();

        expect(group?.editorCount).toBe(0);
    });

    it("рецепт файлов переживает строку сессии туда и обратно", async () => {
        const pane = await openFilesDiff();
        const recipe = factory().describe(pane);

        const value = factory().serialize(recipe);

        expect(value).toBeDefined();
        expect(factory().deserialize(value!)).toEqual(files());
    });

    it("в сессию не идут буфер обмена и git:-сторона", () => {
        const clipboard: IOpenDiffPairOptions = {
            ...files(),
            original: { text: "clip", label: "Clipboard", identity: "c" },
        };
        const git: IOpenDiffPairOptions = {
            ...files(),
            modified: { uri: Uri.from({ scheme: "git", path: "/b.txt", query: "HEAD" }), label: "HEAD", identity: "g" },
        };

        expect(factory().serialize(clipboard)).toBeUndefined();
        expect(factory().serialize(git)).toBeUndefined();
        // Ресурс file:, но содержимое стороны — не он: текст или своя модель.
        const fileUri = Uri.file(ws.path("a.txt"));
        expect(
            factory().serialize({ ...files(), original: { uri: fileUri, text: "x", label: "a", identity: "t" } }),
        ).toBeUndefined();
        const owned = service().createUntitledModel();
        expect(
            factory().serialize({
                ...files(),
                modified: { uri: fileUri, ownedModel: owned, label: "a", identity: "o" },
            }),
        ).toBeUndefined();
    });

    it("чужая или битая строка сессии — undefined, а не исключение", () => {
        const side = { uri: "file:///a", label: "a", identity: "a" };
        for (const value of [
            JSON.stringify({ original: null, modified: side }),
            "{not json",
            "null",
            "42",
            JSON.stringify({ original: side }),
            JSON.stringify({ original: side, modified: null }),
            JSON.stringify({ original: side, modified: { uri: "file:///b", label: 1, identity: "b" } }),
            JSON.stringify({ original: side, modified: { uri: 1, label: "b", identity: "b" } }),
            JSON.stringify({ original: side, modified: { uri: "file:///b", label: "b" } }),
        ]) {
            expect(factory().deserialize(value)).toBeUndefined();
        }
    });

    it("необязательные поля стороны читаются только своего вида", () => {
        const value = JSON.stringify({
            original: { uri: "file:///a", label: "a", identity: "a", preferDisk: "yes", onMissing: "maybe" },
            modified: { uri: "file:///b", label: "b", identity: "b", preferDisk: false, onMissing: "error" },
            title: 7,
        });

        expect(factory().deserialize(value)).toEqual({
            original: { uri: Uri.parse("file:///a"), label: "a", identity: "a" },
            modified: { uri: Uri.parse("file:///b"), label: "b", identity: "b", preferDisk: false, onMissing: "error" },
        });
    });
});
