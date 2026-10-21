import * as fs from "node:fs";

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { FindComponentDIToken } from "../contrib/find/browser/findComponent.ts";
import { DialogServiceDIToken } from "../services/dialogs/browser/dialogService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

import { EditorPartComponentDIToken } from "./parts/editor/editorPartComponent.ts";
import { WorkbenchContextKeysDIToken } from "./workbenchContextKeys.ts";

describe("Workbench — editor groups (сплиты)", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    const MANY_LINES = Array.from({ length: 60 }, (_, i) => `line-${i}`).join("\n");

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-editor-groups-",
            files: { "alpha.txt": MANY_LINES, "beta.txt": "beta", "gamma.txt": "gamma" },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(120, 40) });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function service() {
        return h.container.get(EditorServiceDIToken);
    }

    it("US-1: сплит дублирует активную вкладку с кареткой и скроллом, фокус — в новой группе", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        const source = service().getActiveEditor()!;
        source.viewState.goToPosition(40, 3);
        const sourceScroll = source.viewState.scrollTop;
        expect(sourceScroll).toBeGreaterThan(0);

        h.commands.execute("workbench.action.splitEditor");

        const groups = service().editorGroups.groups;
        expect(groups.length).toBe(2);
        expect(service().editorGroups.activeGroup === groups[1]).toBe(true);
        const left = groups[0].activePane;
        const right = groups[1].activePane;
        expect(left?.uri.toString()).toBe(right?.uri.toString());
        const copy = service().getActiveEditor()!;
        expect(copy === source).toBe(false);
        expect(copy.model === source.model).toBe(true);
        expect(copy.viewState.selections[0].active).toEqual({ line: 40, character: 3 });
        expect(copy.viewState.scrollTop).toBe(sourceScroll);
        const focused = h.testApp.focusedElement;
        expect(focused).not.toBeNull();
        expect(focused!.getAncestorPath().includes(right!.view)).toBe(true);
    });

    it("US-2: сплит пустой области — no-op без ошибок", () => {
        h.commands.execute("workbench.action.splitEditor");
        expect(service().editorGroups.groups.length).toBe(1);
    });

    it("US-8: не влезаем — сплит молча отклонён, полоса не изменилась", () => {
        h.dispose();
        // 30 columns: 2 groups × 20 minimum do not fit.
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(30, 20) });
        h.workbench.openFile(ws.path("alpha.txt"));

        h.commands.execute("workbench.action.splitEditor");

        expect(service().editorGroups.groups.length).toBe(1);
    });

    it("US-9: фокус группы по номеру (команды First/Second)", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        expect(service().editorGroups.viewColumnOf(service().editorGroups.activeGroup)).toBe(2);

        h.commands.execute("workbench.action.focusFirstEditorGroup");
        expect(service().editorGroups.viewColumnOf(service().editorGroups.activeGroup)).toBe(1);

        h.commands.execute("workbench.action.focusSecondEditorGroup");
        expect(service().editorGroups.viewColumnOf(service().editorGroups.activeGroup)).toBe(2);
    });

    it("US-10: фокус по направлению; за краем полосы — no-op", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");

        h.commands.execute("workbench.action.focusLeftGroup");
        expect(service().editorGroups.viewColumnOf(service().editorGroups.activeGroup)).toBe(1);
        h.commands.execute("workbench.action.focusLeftGroup");
        expect(service().editorGroups.viewColumnOf(service().editorGroups.activeGroup)).toBe(1);

        h.commands.execute("workbench.action.focusRightGroup");
        expect(service().editorGroups.viewColumnOf(service().editorGroups.activeGroup)).toBe(2);
        h.commands.execute("workbench.action.focusRightGroup");
        expect(service().editorGroups.viewColumnOf(service().editorGroups.activeGroup)).toBe(2);
        h.commands.execute("workbench.action.focusAboveGroup");
        expect(service().editorGroups.viewColumnOf(service().editorGroups.activeGroup)).toBe(2);
    });

    it("US-11: navigateEditorGroups обходит полосу по кругу", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.commands.execute("workbench.action.focusFirstEditorGroup");

        h.commands.execute("workbench.action.navigateEditorGroups");
        expect(service().editorGroups.viewColumnOf(service().editorGroups.activeGroup)).toBe(2);
        h.commands.execute("workbench.action.navigateEditorGroups");
        expect(service().editorGroups.viewColumnOf(service().editorGroups.activeGroup)).toBe(1);
    });

    it("US-12: группа помнит активную вкладку и каретку при переключениях", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.workbench.openFile(ws.path("beta.txt"));
        expect(service().getActiveEditor()!.uri.path.endsWith("beta.txt")).toBe(true);

        h.commands.execute("workbench.action.focusFirstEditorGroup");
        const first = service().getActiveEditor()!;
        expect(first.uri.path.endsWith("alpha.txt")).toBe(true);
        first.viewState.goToPosition(25, 4);

        h.commands.execute("workbench.action.focusSecondEditorGroup");
        expect(service().getActiveEditor()!.uri.path.endsWith("beta.txt")).toBe(true);

        h.commands.execute("workbench.action.focusFirstEditorGroup");
        const back = service().getActiveEditor()!;
        expect(back.uri.path.endsWith("alpha.txt")).toBe(true);
        expect(back.viewState.selections[0].active).toEqual({ line: 25, character: 4 });
    });

    it("US-13: Ctrl+Tab циклит вкладки ВНУТРИ группы, чужая группа не участвует", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.workbench.openFile(ws.path("beta.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.workbench.openFile(ws.path("gamma.txt"));

        const groups = service().editorGroups.groups;
        expect(groups[0].editorCount).toBe(2);
        expect(groups[1].editorCount).toBe(2);

        h.commands.execute("workbench.action.focusFirstEditorGroup");
        service().editorGroups.activeGroup.cycleMru(1);
        service().editorGroups.activeGroup.endMruCycle();

        expect(service().editorGroups.viewColumnOf(service().editorGroups.activeGroup)).toBe(1);
        expect(service().getActiveEditor()!.uri.path.endsWith("alpha.txt")).toBe(true);
        expect(groups[1].activePane!.uri.path.endsWith("gamma.txt")).toBe(true);
    });

    it("US-14: фокус в поддереве группы делает её активной (клик мышью)", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        const groups = service().editorGroups.groups;
        expect(service().editorGroups.activeGroup === groups[1]).toBe(true);

        groups[0].activePane!.focusEditor();

        expect(service().editorGroups.activeGroup === groups[0]).toBe(true);
    });

    it("US-16-механика: закрытие последней вкладки схлопывает группу, фокус — соседке", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        expect(service().editorGroups.groups.length).toBe(2);

        h.commands.execute("workbench.action.closeActiveEditor");

        expect(service().editorGroups.groups.length).toBe(1);
        expect(service().editorGroups.activeGroup === service().editorGroups.groups[0]).toBe(true);
        expect(service().getActiveEditor()!.uri.path.endsWith("alpha.txt")).toBe(true);
        const focused = h.testApp.focusedElement;
        expect(focused).not.toBeNull();
    });

    it("US-30: дедуп вкладок — пер-группный (общая модель, две вкладки)", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        const groups = service().editorGroups.groups;

        h.workbench.openFile(ws.path("alpha.txt"));
        expect(groups[1].editorCount).toBe(1);

        const left = groups[0].getPanes()[0];
        const right = groups[1].getPanes()[0];
        expect(left !== right).toBe(true);
        expect((left as { model?: unknown }).model === (right as { model?: unknown }).model).toBe(true);
    });

    it("US-4: новая пустая группа фокусируема и принимает открытие файла", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.newGroupRight");

        const groups = service().editorGroups.groups;
        expect(groups.length).toBe(2);
        expect(groups[1].editorCount).toBe(0);
        expect(service().editorGroups.activeGroup === groups[1]).toBe(true);
        expect(h.testApp.focusedElement).not.toBeNull();

        h.workbench.openFile(ws.path("beta.txt"));
        expect(groups[1].editorCount).toBe(1);
        expect(groups[1].activePane!.uri.path.endsWith("beta.txt")).toBe(true);
    });

    it("US-47: последняя вкладка последней группы — остаётся одна пустая группа", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.closeActiveEditor");

        expect(service().editorGroups.groups.length).toBe(1);
        expect(service().editorGroups.groups[0].editorCount).toBe(0);
    });

    it("направленный сплит поперёк оси: одна группа меняет ось, разложенная полоса — нет", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        const part = h.container.get(EditorPartComponentDIToken);
        h.commands.execute("workbench.action.splitEditorDown");
        expect(service().editorGroups.groups.length).toBe(2);
        // The axis is not a side effect of the split: it decides where the next group goes
        // and which cross-axis split is refused.
        expect(part.orientation).toBe("rows");

        h.commands.execute("workbench.action.splitEditorRight");
        expect(service().editorGroups.groups.length).toBe(2);
        expect(part.orientation).toBe("rows");
    });

    it("адресованный сплит активирует чужую вкладку, но фокус за собой не уводит", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        const first = service().editorGroups.activeGroup;
        h.commands.execute("workbench.action.splitEditorDown");
        const second = service().editorGroups.activeGroup;
        expect(second.id).not.toBe(first.id);

        // The cross-axis split is refused, yet the tab is activated: this shows that a right
        // click on another group's tab does not steal focus.
        h.commands.execute("workbench.action.splitEditorRight", first.id, 0);

        expect(service().editorGroups.groups.length).toBe(2);
        expect(service().editorGroups.activeGroup.id).toBe(first.id);
        const focused = h.testApp.focusedElement;
        expect(focused).not.toBeNull();
        expect(focused!.getAncestorPath().includes(second.activePane!.view)).toBe(true);
    });

    it("Split Right на одной группе ставит ось колонками", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        const part = h.container.get(EditorPartComponentDIToken);

        h.commands.execute("workbench.action.splitEditorRight");

        expect(service().editorGroups.groups.length).toBe(2);
        expect(part.orientation).toBe("columns");
    });

    it("повторный dispose подписок сервиса групп — no-op, чужие слушатели живы", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        let activeFired = 0;
        let groupsFired = 0;
        const activeFirst = service().editorGroups.onDidActiveGroupChange(() => {});
        service().editorGroups.onDidActiveGroupChange(() => activeFired++);
        const groupsFirst = service().editorGroups.onDidGroupsChange(() => {});
        service().editorGroups.onDidGroupsChange(() => groupsFired++);

        activeFirst.dispose();
        activeFirst.dispose(); // indexOf === -1: the second listener stays
        groupsFirst.dispose();
        groupsFirst.dispose();

        h.commands.execute("workbench.action.splitEditor");
        expect(groupsFired).toBeGreaterThan(0);
        expect(activeFired).toBeGreaterThan(0);
    });

    it("rows: саш занимает свою строку — таб нижней группы достижим мышью", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditorDown");
        h.testApp.render();

        // The bottom group's first row is its tab strip: a sash over it would steal the hit-test.
        const bottom = h.testApp.querySelector("#editorGroup-2")!;
        const tabStrip = bottom.querySelector("EditorTabStripElement")!;
        const point = new Point(tabStrip.globalPosition.x + 2, tabStrip.globalPosition.y);
        let hit = h.testApp.root.elementFromPoint(point);
        expect(hit?.constructor.name).not.toBe("SashElement");
        while (hit !== null && hit !== tabStrip) hit = hit.getParent();
        expect(hit === tabStrip).toBe(true);
    });

    it("US-15: перенос вкладки в соседнюю группу — фокус едет со вкладкой", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.workbench.openFile(ws.path("beta.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.commands.execute("workbench.action.focusFirstEditorGroup");
        const groups = service().editorGroups.groups;
        expect(groups[0].activePane!.uri.path.endsWith("beta.txt")).toBe(true);

        h.commands.execute("workbench.action.moveEditorToNextGroup");

        expect(groups[0].editorCount).toBe(1);
        expect(groups[1].editorCount).toBe(1);
        expect(service().editorGroups.activeGroup === groups[1]).toBe(true);
        expect(service().getActiveEditor()!.uri.path.endsWith("beta.txt")).toBe(true);
    });

    it("US-50: перенос у единственной группы создаёт соседку", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.workbench.openFile(ws.path("beta.txt"));

        h.commands.execute("workbench.action.moveEditorToNextGroup");

        const groups = service().editorGroups.groups;
        expect(groups.length).toBe(2);
        expect(groups[0].editorCount).toBe(1);
        expect(groups[1].editorCount).toBe(1);
        expect(groups[1].activePane!.uri.path.endsWith("beta.txt")).toBe(true);
    });

    it("US-16: перенос последней вкладки схлопывает группу-источник", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        // beta, not alpha: moving alpha would merge it with its copy in group 2.
        h.commands.execute("workbench.action.focusFirstEditorGroup");
        h.workbench.openFile(ws.path("beta.txt"));

        h.commands.execute("workbench.action.moveEditorToNextGroup");

        h.commands.execute("workbench.action.focusFirstEditorGroup");
        h.commands.execute("workbench.action.moveEditorToNextGroup");

        expect(service().editorGroups.groups.length).toBe(1);
        expect(service().editorGroups.groups[0].editorCount).toBe(2);
    });

    it("US-17: дублирование вкладки в соседнюю группу — общая модель", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.newGroupRight");
        h.commands.execute("workbench.action.focusFirstEditorGroup");

        h.commands.execute("workbench.action.copyEditorToNextGroup");

        const groups = service().editorGroups.groups;
        expect(groups[0].editorCount).toBe(1);
        expect(groups[1].editorCount).toBe(1);
        const original = groups[0].getPanes()[0] as { model?: unknown };
        const copy = groups[1].getPanes()[0] as { model?: unknown };
        expect(copy !== original).toBe(true);
        expect(copy.model === original.model).toBe(true);
    });

    it("US-18: перестановка активной группы по полосе", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.workbench.openFile(ws.path("beta.txt"));
        const movedGroup = service().editorGroups.activeGroup;
        expect(service().editorGroups.viewColumnOf(movedGroup)).toBe(2);

        h.commands.execute("workbench.action.moveActiveEditorGroupLeft");

        expect(service().editorGroups.viewColumnOf(movedGroup)).toBe(1);
        expect(service().editorGroups.activeGroup === movedGroup).toBe(true);
        h.commands.execute("workbench.action.moveActiveEditorGroupLeft");
        expect(service().editorGroups.viewColumnOf(movedGroup)).toBe(1);
    });

    it("US-21: joinAllGroups сливает всё в одну, дубликаты схлопнуты, активная вкладка выживает", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.workbench.openFile(ws.path("beta.txt"));

        h.commands.execute("workbench.action.joinAllGroups");

        const groups = service().editorGroups.groups;
        expect(groups.length).toBe(1);
        expect(groups[0].editorCount).toBe(2);
        expect(service().getActiveEditor()!.uri.path.endsWith("beta.txt")).toBe(true);
    });

    it("US-19: тумблер оси сохраняет группы и содержимое", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");

        h.commands.execute("workbench.action.toggleEditorGroupLayout");
        h.testApp.render();

        const groups = service().editorGroups.groups;
        expect(groups.length).toBe(2);
        const top = groups[0].activePane!.view;
        const bottom = groups[1].activePane!.view;
        expect(top.globalPosition.y).toBeLessThan(bottom.globalPosition.y);
        expect(top.globalPosition.x).toBe(bottom.globalPosition.x);
    });

    it("US-24: максимизация активной группы прячет остальные и возвращается тумблером", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.testApp.render();

        h.commands.execute("workbench.action.toggleMaximizeEditorGroup");
        h.testApp.render();

        const groups = service().editorGroups.groups;
        const leftView = groups[0].activePane!.view;
        const rightView = groups[1].activePane!.view;
        const part = h.testApp.querySelector("EditorPartElement")!;
        expect(rightView.layoutSize.width).toBe(part.layoutSize.width);
        expect(leftView.getAncestorPath().some((el) => el.hidden)).toBe(true);

        h.commands.execute("workbench.action.toggleMaximizeEditorGroup");
        h.testApp.render();
        expect(leftView.getAncestorPath().every((el) => !el.hidden)).toBe(true);
    });

    it("US-23: resize-команды меняют долю активной группы и сбрасываются", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.testApp.render();
        const groups = service().editorGroups.groups;
        const before = groups[1].activePane!.view.layoutSize.width;

        h.commands.execute("workbench.action.increaseEditorWidth");
        h.testApp.render();
        expect(groups[1].activePane!.view.layoutSize.width).toBe(before + 3);

        h.commands.execute("workbench.action.evenEditorWidths");
        h.testApp.render();
        expect(Math.abs(groups[1].activePane!.view.layoutSize.width - before)).toBeLessThanOrEqual(1);
    });

    it("US-5-механика: открытие beside создаёт/переиспользует соседнюю группу", () => {
        h.workbench.openFile(ws.path("alpha.txt"));

        void service().openUri(service().getActiveEditor()!.uri, { group: "beside" });
        expect(service().editorGroups.groups.length).toBe(2);
        expect(service().editorGroups.activeGroup === service().editorGroups.groups[1]).toBe(true);

        h.commands.execute("workbench.action.focusFirstEditorGroup");
        service().openFile(ws.path("beta.txt"), { group: "beside" });
        expect(service().editorGroups.groups.length).toBe(2);
        expect(service().editorGroups.groups[1].editorCount).toBe(2);
    });

    it("US-48: Close All Editors in Group — диалог по изменённой, после ответа группа схлопнулась", async () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.workbench.openFile(ws.path("gamma.txt"));
        const groups = service().editorGroups.groups;
        const alphaPane = groups[1].getPanes()[0];
        (alphaPane as { viewState: { type(t: string): unknown } }).viewState.type("dirty!");
        expect(alphaPane.isModified).toBe(true);

        h.commands.execute("workbench.action.closeEditorsInGroup");
        await new Promise((resolve) => setTimeout(resolve, 0));

        // alpha is also open in group 1, so it is not the document's last tab and closes without a dialog.
        const dialogs = h.container.get(DialogServiceDIToken);
        expect(dialogs.getOpenConfirmSaveDialog()).toBeNull();
        expect(service().editorGroups.groups.length).toBe(1);

        h.commands.execute("workbench.action.closeEditorsInGroup");
        await new Promise((resolve) => setTimeout(resolve, 0));
        const dialog = dialogs.getOpenConfirmSaveDialog();
        expect(dialog).not.toBeNull();
        dialog!.onDontSave?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(service().editorGroups.groups[0].editorCount).toBe(0);
        // Don't Save must really not save: without the disk check the save branch could be
        // made unconditional and the edit would reach the file against the answer.
        expect(fs.readFileSync(ws.path("alpha.txt"), "utf8")).toBe(MANY_LINES);
    });

    it("US-33: у каждой группы свой find-виджет с независимым запросом; Escape локален", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.testApp.render();
        const find = h.container.get(FindComponentDIToken);
        const groups = service().editorGroups.groups;

        h.commands.execute("actions.find");
        const widgetB = find.widgetFor(groups[1].id)!;
        widgetB.setQuery("line");
        widgetB.onQueryChange?.("line");
        expect(find.isOpen(groups[1].id)).toBe(true);

        h.commands.execute("workbench.action.focusFirstEditorGroup");
        expect(find.isOpen(groups[1].id)).toBe(true);

        h.commands.execute("actions.find");
        const widgetA = find.widgetFor(groups[0].id)!;
        widgetA.setQuery("alpha-only");
        widgetA.onQueryChange?.("alpha-only");
        expect(find.isOpen(groups[0].id)).toBe(true);
        expect(widgetB.getQuery()).toBe("line");

        h.commands.execute("closeFindWidget");
        expect(find.isOpen(groups[0].id)).toBe(false);
        expect(find.isOpen(groups[1].id)).toBe(true);
    });

    it("схлопывание группы забирает её find-виджет и сессию", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.testApp.render();
        const find = h.container.get(FindComponentDIToken);
        const collapsedGroup = service().editorGroups.activeGroup;

        h.commands.execute("actions.find");
        expect(find.isOpen(collapsedGroup.id)).toBe(true);

        service().editorGroups.activeGroup.closeTab(0);
        expect(service().editorGroups.groups.length).toBe(1);
        expect(find.widgetIfExists(collapsedGroup.id)).toBeNull();
    });

    it("US-35: статус-бар следует за активной группой (Ln/Col из её редактора)", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        service().getActiveEditor()!.viewState.goToPosition(20, 5);
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("Ln 21, Col 6");

        h.commands.execute("workbench.action.focusFirstEditorGroup");
        service().getActiveEditor()!.viewState.goToPosition(2, 0);
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("Ln 3, Col 1");

        h.commands.execute("workbench.action.focusSecondEditorGroup");
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("Ln 21, Col 6");
    });

    it("US-37: сквиглы диагностик приходят в обе вью документа", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        const groups = service().editorGroups.groups;
        const editors = service().getEditors();
        expect(editors.length).toBe(2);
        expect(service().editorGroups.groupOf(editors[0]) === groups[0]).toBe(true);
        expect(service().editorGroups.groupOf(editors[1]) === groups[1]).toBe(true);
    });

    it("focusActiveEditorGroup фокусирует содержимое именно активной группы", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        const groups = service().editorGroups;
        const viewHook = groups.focusGroupContentHook;
        const focused: number[] = [];
        groups.focusGroupContentHook = (group) => {
            focused.push(groups.viewColumnOf(group));
            viewHook?.(group);
        };

        h.commands.execute("workbench.action.focusActiveEditorGroup");

        expect(focused).toEqual([2]);
    });

    it("US-38: фокус в панели не меняет активную группу; focusActiveEditorGroup возвращает", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        const active = service().editorGroups.activeGroup;

        h.commands.execute("workbench.action.togglePanel");
        h.testApp.render();
        expect(service().editorGroups.activeGroup === active).toBe(true);

        h.commands.execute("workbench.action.focusActiveEditorGroup");
        const focused = h.testApp.focusedElement;
        expect(focused).not.toBeNull();
        expect(focused!.getAncestorPath().includes(active.activePane!.view)).toBe(true);
    });

    it("US-40: detached-редактор (Output) не попадает в группы и ViewColumn", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        const detached = service().openDetached(
            service().getActiveEditor()!.uri.with({ scheme: "output", path: "test" }),
            "plaintext",
        );
        expect(service().editorGroups.groups.length).toBe(1);
        expect(service().editorGroups.groupOf(detached)).toBeNull();
        expect(service().editorGroups.activeGroup.getPanes().includes(detached)).toBe(false);
    });

    it("контекст-ключи групп: multipleEditorGroups и activeEditorGroup*", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        const keys = h.container.get(ContextKeyServiceDIToken);
        h.container.get(WorkbenchContextKeysDIToken).update();
        expect(keys.evaluate("multipleEditorGroups")).toBe(false);
        expect(keys.evaluate("activeEditorGroupIndex == 1")).toBe(true);
        expect(keys.evaluate("activeEditorGroupLast")).toBe(true);

        h.commands.execute("workbench.action.splitEditor");
        h.container.get(WorkbenchContextKeysDIToken).update();
        expect(keys.evaluate("multipleEditorGroups")).toBe(true);
        expect(keys.evaluate("activeEditorGroupIndex == 2")).toBe(true);
        expect(keys.evaluate("activeEditorGroupLast")).toBe(true);
        expect(keys.evaluate("activeEditorGroupEmpty")).toBe(false);

        h.commands.execute("workbench.action.focusFirstEditorGroup");
        h.container.get(WorkbenchContextKeysDIToken).update();
        expect(keys.evaluate("activeEditorGroupIndex == 1")).toBe(true);
        expect(keys.evaluate("activeEditorGroupLast")).toBe(false);
    });

    it("группы делят полосу поровну после сплита (лэйаут кадра)", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.testApp.render();

        const groups = service().editorGroups.groups;
        const leftView = groups[0].activePane!.view;
        const rightView = groups[1].activePane!.view;
        expect(leftView.globalPosition.x).toBeLessThan(rightView.globalPosition.x);
        expect(Math.abs(leftView.layoutSize.width - rightView.layoutSize.width)).toBeLessThanOrEqual(1);
    });

    it("US-3: Split Editor Left — новая группа с копией вкладки встаёт слева от источника", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        const source = service().editorGroups.activeGroup;

        h.commands.execute("workbench.action.splitEditorLeft");

        expect(service().editorGroups.groups.length).toBe(2);
        expect(service().editorGroups.viewColumnOf(service().editorGroups.activeGroup)).toBe(1);
        expect(service().editorGroups.viewColumnOf(source)).toBe(2);
        expect(service().getActiveEditor()!.uri.path.endsWith("alpha.txt")).toBe(true);
    });

    it("US-3: Split Editor Up — единственная группа меняет ось, копия сверху", () => {
        h.workbench.openFile(ws.path("alpha.txt"));

        h.commands.execute("workbench.action.splitEditorUp");
        h.testApp.render();

        const groups = service().editorGroups.groups;
        expect(groups.length).toBe(2);
        expect(service().editorGroups.viewColumnOf(service().editorGroups.activeGroup)).toBe(1);
        const top = groups[0].activePane!.view;
        const bottom = groups[1].activePane!.view;
        expect(top.globalPosition.y).toBeLessThan(bottom.globalPosition.y);
    });

    it("US-4: newGroup по направлениям — вдоль оси создаётся, поперёк разложенной полосы отказ", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditorDown");

        h.commands.execute("workbench.action.newGroupBelow");
        expect(service().editorGroups.groups.length).toBe(3);
        expect(service().editorGroups.activeGroup.editorCount).toBe(0);

        h.commands.execute("workbench.action.newGroupAbove");
        expect(service().editorGroups.groups.length).toBe(4);

        h.commands.execute("workbench.action.newGroupLeft");
        expect(service().editorGroups.groups.length).toBe(4);
    });

    it("US-4: New Group Left в колоночной полосе — пустая группа слева", () => {
        h.workbench.openFile(ws.path("alpha.txt"));

        h.commands.execute("workbench.action.newGroupLeft");

        const groups = service().editorGroups.groups;
        expect(groups.length).toBe(2);
        expect(service().editorGroups.activeGroup === groups[0]).toBe(true);
        expect(groups[0].editorCount).toBe(0);
        expect(groups[1].editorCount).toBe(1);
    });

    it("US-10: focusAbove/BelowGroup ходят по рядной полосе", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditorDown");
        expect(service().editorGroups.viewColumnOf(service().editorGroups.activeGroup)).toBe(2);

        h.commands.execute("workbench.action.focusAboveGroup");
        expect(service().editorGroups.viewColumnOf(service().editorGroups.activeGroup)).toBe(1);

        h.commands.execute("workbench.action.focusBelowGroup");
        expect(service().editorGroups.viewColumnOf(service().editorGroups.activeGroup)).toBe(2);
    });

    it("US-9: фокус по номеру за краем полосы — no-op (Ctrl+K 5 при двух группах)", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");

        h.commands.execute("workbench.action.focusFifthEditorGroup");

        expect(service().editorGroups.viewColumnOf(service().editorGroups.activeGroup)).toBe(2);
    });

    it("focusGroup по id схлопнутой группы — no-op (протухшая ссылка)", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        const dead = service().editorGroups.activeGroup;
        dead.closeTab(0);

        service().editorGroups.focusGroup(dead.id);

        expect(service().editorGroups.groups.length).toBe(1);
        expect(service().editorGroups.activeGroup === service().editorGroups.groups[0]).toBe(true);
    });

    it("сплит безымянного буфера: untitled не дублируется, новая группа пустая", () => {
        service().newUntitled();
        const untitledView = h.testApp.focusedElement;

        const group = service().splitActiveGroup();

        expect(group).not.toBeNull();
        expect(group!.editorCount).toBe(0);
        expect(service().editorGroups.activeGroup === group).toBe(true);
        expect(service().getActiveEditor()).toBeNull();

        h.commands.execute("workbench.action.focusFirstEditorGroup");
        expect(service().getActiveEditor()).not.toBeNull();
        const focusedBefore = h.testApp.focusedElement;
        const another = service().splitActiveGroup({ focus: false });
        expect(another).not.toBeNull();
        expect(h.testApp.focusedElement === focusedBefore).toBe(true);
        expect(untitledView).not.toBeNull();
    });

    it("US-8: узкий терминал — отказ newGroup, переносу у единственной группы и beside-фолбэк", () => {
        h.dispose();
        // 30 columns: 2 groups × 20 minimum do not fit.
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(30, 20) });
        h.workbench.openFile(ws.path("alpha.txt"));
        h.workbench.openFile(ws.path("beta.txt"));

        h.commands.execute("workbench.action.newGroupRight");
        expect(service().editorGroups.groups.length).toBe(1);

        h.commands.execute("workbench.action.moveEditorToNextGroup");
        expect(service().editorGroups.groups.length).toBe(1);
        expect(service().editorGroups.activeGroup.editorCount).toBe(2);

        service().openFile(ws.path("gamma.txt"), { group: "beside" });
        expect(service().editorGroups.groups.length).toBe(1);
        expect(service().getActiveEditor()!.uri.path.endsWith("gamma.txt")).toBe(true);
    });

    it("перенос/копия за краем полосы — no-op", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.workbench.openFile(ws.path("beta.txt"));

        h.commands.execute("workbench.action.moveEditorToNextGroup");
        expect(service().editorGroups.groups.length).toBe(2);
        expect(service().editorGroups.activeGroup.editorCount).toBe(2);

        h.commands.execute("workbench.action.copyEditorToNextGroup");
        expect(service().editorGroups.groups.length).toBe(2);
        expect(service().editorGroups.activeGroup.editorCount).toBe(2);
    });

    it("перенос из пустой группы — no-op", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.newGroupRight");

        service().editorGroups.moveActiveEditorToGroup("previous");

        expect(service().editorGroups.groups.length).toBe(2);
        expect(service().editorGroups.groups[0].editorCount).toBe(1);
    });

    it("US-50-зеркало: перенос против хода у единственной группы создаёт соседку слева", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.workbench.openFile(ws.path("beta.txt"));

        h.commands.execute("workbench.action.moveEditorToPreviousGroup");

        const groups = service().editorGroups.groups;
        expect(groups.length).toBe(2);
        expect(service().editorGroups.viewColumnOf(service().editorGroups.activeGroup)).toBe(1);
        expect(service().editorGroups.activeGroup.activePane!.uri.path.endsWith("beta.txt")).toBe(true);
        expect(groups[1].editorCount).toBe(1);
    });

    it("US-17-зеркало: дублирование в предыдущую группу; ресурс уже там — просто активация", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");

        h.commands.execute("workbench.action.copyEditorToPreviousGroup");

        const groups = service().editorGroups.groups;
        expect(groups[0].editorCount).toBe(1);
        expect(service().editorGroups.activeGroup === groups[0]).toBe(true);
        expect(service().getActiveEditor()!.uri.path.endsWith("alpha.txt")).toBe(true);
    });

    it("копия безымянного буфера не делается (нет общего файла)", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        service().newUntitled();

        h.commands.execute("workbench.action.copyEditorToPreviousGroup");

        expect(service().editorGroups.groups[0].editorCount).toBe(1);
        expect(service().editorGroups.activeGroup === service().editorGroups.groups[1]).toBe(true);
    });

    it("US-18-зеркало: перестановка группы вправо; у края — no-op", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.commands.execute("workbench.action.focusFirstEditorGroup");
        const moved = service().editorGroups.activeGroup;

        h.commands.execute("workbench.action.moveActiveEditorGroupRight");
        expect(service().editorGroups.viewColumnOf(moved)).toBe(2);

        h.commands.execute("workbench.action.moveActiveEditorGroupRight");
        expect(service().editorGroups.viewColumnOf(moved)).toBe(2);
    });

    it("US-20: joinTwoGroups вливает следующую группу; единственная группа — no-op", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.joinTwoGroups");
        expect(service().editorGroups.groups.length).toBe(1);

        h.commands.execute("workbench.action.splitEditor");
        h.workbench.openFile(ws.path("beta.txt"));
        h.commands.execute("workbench.action.focusFirstEditorGroup");

        h.commands.execute("workbench.action.joinTwoGroups");

        const groups = service().editorGroups.groups;
        expect(groups.length).toBe(1);
        expect(groups[0].editorCount).toBe(2);
    });

    it("US-20: joinTwoGroups с пустым соседом просто схлопывает его", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.newGroupRight");
        h.commands.execute("workbench.action.focusFirstEditorGroup");

        h.commands.execute("workbench.action.joinTwoGroups");

        expect(service().editorGroups.groups.length).toBe(1);
        expect(service().editorGroups.groups[0].editorCount).toBe(1);
    });

    it("US-21: joinAllGroups при пустой активной группе — вспоминать нечего, полоса сливается", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.newGroupRight");

        h.commands.execute("workbench.action.joinAllGroups");

        expect(service().editorGroups.groups.length).toBe(1);
        expect(service().editorGroups.groups[0].editorCount).toBe(1);
    });

    it("editorLayoutSingle сводит полосу к одной колонке; повторный вызов — no-op", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");

        h.commands.execute("workbench.action.editorLayoutSingle");
        expect(service().editorGroups.groups.length).toBe(1);

        h.commands.execute("workbench.action.editorLayoutSingle");
        expect(service().editorGroups.groups.length).toBe(1);
    });

    it("US-23: resize поперёк оси полосы — no-op (высота в колоночной полосе)", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.testApp.render();
        const before = service().editorGroups.groups[1].activePane!.view.layoutSize.height;

        h.commands.execute("workbench.action.increaseEditorHeight");
        h.testApp.render();

        expect(service().editorGroups.groups[1].activePane!.view.layoutSize.height).toBe(before);
    });

    it("US-19: повторный тумблер оси возвращает колоночную полосу", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");

        h.commands.execute("workbench.action.toggleEditorGroupLayout");
        h.commands.execute("workbench.action.toggleEditorGroupLayout");
        h.testApp.render();

        const groups = service().editorGroups.groups;
        const left = groups[0].activePane!.view;
        const right = groups[1].activePane!.view;
        expect(left.globalPosition.x).toBeLessThan(right.globalPosition.x);
        expect(left.globalPosition.y).toBe(right.globalPosition.y);
    });

    it("US-24: максимизация переезжает за сменой активной группы", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.testApp.render();

        h.commands.execute("workbench.action.toggleMaximizeEditorGroup");
        h.testApp.render();
        h.commands.execute("workbench.action.focusFirstEditorGroup");
        h.testApp.render();

        const groups = service().editorGroups.groups;
        const part = h.testApp.querySelector("EditorPartElement")!;
        expect(groups[0].activePane!.view.layoutSize.width).toBe(part.layoutSize.width);
        expect(groups[1].activePane!.view.getAncestorPath().some((el) => el.hidden)).toBe(true);
    });

    it("groupOverlayHost схлопнутой группы — null", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        const collapsed = service().editorGroups.activeGroup;
        const part = h.container.get(EditorPartComponentDIToken);
        expect(part.groupOverlayHost(collapsed.id)).not.toBeNull();

        collapsed.closeTab(0);

        expect(part.groupOverlayHost(collapsed.id)).toBeNull();
    });

    it("US-16: Close Editor Group закрывает вкладки и схлопывает группу", async () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.workbench.openFile(ws.path("beta.txt"));

        h.commands.execute("workbench.action.closeEditorsAndGroup");
        await vi.waitFor(() => {
            expect(service().editorGroups.groups.length).toBe(1);
        });

        expect(service().editorGroups.groups[0].editorCount).toBe(1);
        expect(service().getActiveEditor()!.uri.path.endsWith("alpha.txt")).toBe(true);
    });

    it("US-48: Cancel в диалоге прерывает закрытие группы, правка жива", async () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        const editor = service().getActiveEditor()!;
        editor.viewState.type("dirty!");

        h.commands.execute("workbench.action.closeEditorsInGroup");
        const dialogs = h.container.get(DialogServiceDIToken);
        await vi.waitFor(() => {
            expect(dialogs.getOpenConfirmSaveDialog()).not.toBeNull();
        });
        // The dialog must name the file it asks about: otherwise Save and Don't Save
        // are blind answers.
        h.testApp.render();
        // With the question mark: otherwise the assert would pass on the tab name in the strip
        // rather than on the dialog caption.
        expect(h.testApp.backend.screenToString()).toContain("alpha.txt?");

        dialogs.getOpenConfirmSaveDialog()!.onCancel?.();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(service().editorGroups.activeGroup.editorCount).toBe(1);
        expect(editor.isModified).toBe(true);
    });

    it("US-48: Ctrl+K W закрывает группу с хвоста — чистые вкладки уходят до диалога", async () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.workbench.openFile(ws.path("beta.txt"));
        h.workbench.openFile(ws.path("gamma.txt"));
        // The dirty tab is the LEFTMOST: walking from the tail reaches it last.
        const dirty = service().editorGroups.activeGroup.getPanes()[0] as {
            viewState: { type(text: string): unknown };
        };
        dirty.viewState.type("dirty!");

        h.commands.execute("workbench.action.closeEditorsInGroup");
        const dialogs = h.container.get(DialogServiceDIToken);
        await vi.waitFor(() => {
            expect(dialogs.getOpenConfirmSaveDialog()).not.toBeNull();
        });
        dialogs.getOpenConfirmSaveDialog()!.onCancel?.();
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Walking from the tail, beta and gamma close before the question about alpha, and
        // Cancel stops the series there. Walking from the head, the dialog would come up
        // on the very first step and nothing would close.
        expect(service().editorGroups.activeGroup.editorCount).toBe(1);
        expect(service().editorGroups.activeGroup.getPanes()[0].label).toBe("alpha.txt");
    });

    it("US-48: Save в диалоге пишет файл и закрывает вкладку", async () => {
        h.workbench.openFile(ws.path("beta.txt"));
        service().getActiveEditor()!.viewState.type("saved!");

        h.commands.execute("workbench.action.closeEditorsInGroup");
        const dialogs = h.container.get(DialogServiceDIToken);
        await vi.waitFor(() => {
            expect(dialogs.getOpenConfirmSaveDialog()).not.toBeNull();
        });

        dialogs.getOpenConfirmSaveDialog()!.onSave?.();
        await vi.waitFor(() => {
            expect(service().editorGroups.activeGroup.editorCount).toBe(0);
        });

        expect(fs.readFileSync(ws.path("beta.txt"), "utf8")).toContain("saved!");
    });

    it("US-48: Save в диалоге дожимает запись поверх внешней правки файла", async () => {
        h.workbench.openFile(ws.path("beta.txt"));
        service().getActiveEditor()!.viewState.type("saved!");
        // The file was changed externally. A regular save would fail here with a
        // conflict, but the close dialog must force the write: otherwise the tab
        // closes on Save while the edit never reaches the file.
        fs.writeFileSync(ws.path("beta.txt"), "external", "utf8");

        h.commands.execute("workbench.action.closeEditorsInGroup");
        const dialogs = h.container.get(DialogServiceDIToken);
        await vi.waitFor(() => {
            expect(dialogs.getOpenConfirmSaveDialog()).not.toBeNull();
        });
        dialogs.getOpenConfirmSaveDialog()!.onSave?.();
        await vi.waitFor(() => {
            expect(service().editorGroups.activeGroup.editorCount).toBe(0);
        });

        expect(fs.readFileSync(ws.path("beta.txt"), "utf8")).toContain("saved!");
    });

    it("US-22: Close All Editors обходит все группы; пустая активная не мешает", async () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.workbench.openFile(ws.path("beta.txt"));
        h.commands.execute("workbench.action.newGroupRight");

        h.commands.execute("workbench.action.closeAllEditors");
        await vi.waitFor(() => {
            expect(service().editorGroups.groups.length).toBe(1);
        });

        expect(service().editorGroups.groups[0].editorCount).toBe(0);
    });

    it("US-22: Cancel в диалоге прерывает Close All Editors", async () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        service().getActiveEditor()!.viewState.type("dirty!");

        h.commands.execute("workbench.action.closeAllEditors");
        const dialogs = h.container.get(DialogServiceDIToken);
        await vi.waitFor(() => {
            expect(dialogs.getOpenConfirmSaveDialog()).not.toBeNull();
        });

        dialogs.getOpenConfirmSaveDialog()!.onCancel?.();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(service().editorGroups.groups[0].editorCount).toBe(1);
        expect(service().getActiveEditor()!.isModified).toBe(true);
    });

    it("US-22: Cancel в Close All Editors не заходит на второй круг", async () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        service().getActiveEditor()!.viewState.type("dirty!");
        h.commands.execute("workbench.action.newGroupRight");
        h.workbench.openFile(ws.path("beta.txt"));

        h.commands.execute("workbench.action.closeAllEditors");
        const dialogs = h.container.get(DialogServiceDIToken);
        await vi.waitFor(() => {
            expect(dialogs.getOpenConfirmSaveDialog()).not.toBeNull();
        });
        dialogs.getOpenConfirmSaveDialog()!.onCancel?.();
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Cancel stops the walk over groups entirely. If the series returned "all closed",
        // the loop would start a second round and ask about the same tab again, so check
        // not only the state but also that no new dialog appears.
        expect(dialogs.getOpenConfirmSaveDialog()).toBeNull();
        expect(service().editorGroups.groups.length).toBe(2);
        expect(service().editorGroups.groups[1].editorCount).toBe(1);
    });

    it("US-49: collectDirty дедуплицирует документ, открытый в двух группах", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        service().getActiveEditor()!.viewState.type("dirty!");

        expect(service().collectDirty().length).toBe(1);
    });

    it("US-5: Open to the Side из дерева; без выделенного файла — no-op", async () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("explorer.openToSide");
        expect(service().editorGroups.groups.length).toBe(1);

        await h.workbench.activate();
        h.testApp.render();
        const tree = h.testApp.querySelector("TreeViewElement")!;
        tree.focus();
        h.testApp.render();

        h.commands.execute("explorer.openToSide");

        expect(service().editorGroups.groups.length).toBe(2);
        expect(service().editorGroups.viewColumnOf(service().editorGroups.activeGroup)).toBe(2);
        expect(service().getActiveEditor()!.uri.path.endsWith("alpha.txt")).toBe(true);
    });
});
