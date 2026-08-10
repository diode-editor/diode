import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "../../../../tuidom/common/geometryPromitives.ts";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";

import { EditorServiceDIToken } from "../services/editor/browser/editorService.ts";

/**
 * Сплиты области редактора (фаза 3): полоса групп, split/focus-команды,
 * схлопывание опустевшей группы, пер-группные вкладки и MRU. Ассерты — по
 * наблюдаемому состоянию дерева и сервиса, вход — команды и фокус (как у
 * пользователя).
 */
describe("Workbench — editor groups (сплиты)", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    const MANY_LINES = Array.from({ length: 60 }, (_, i) => `line-${i}`).join("\n");

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "vexx-editor-groups-",
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

        const groups = service().groups;
        expect(groups.length).toBe(2);
        expect(service().activeGroup === groups[1]).toBe(true);
        // Обе группы показывают один документ (общая модель).
        const left = groups[0].activePane;
        const right = groups[1].activePane;
        expect(left?.uri.toString()).toBe(right?.uri.toString());
        // Каретка и скролл скопированы в новую вью.
        const copy = service().getActiveEditor()!;
        expect(copy === source).toBe(false);
        expect(copy.model === source.model).toBe(true);
        expect(copy.viewState.selections[0].active).toEqual({ line: 40, character: 3 });
        expect(copy.viewState.scrollTop).toBe(sourceScroll);
        // Фокус — внутри view новой группы.
        const focused = h.testApp.focusedElement;
        expect(focused).not.toBeNull();
        expect(focused!.getAncestorPath().includes(right!.view)).toBe(true);
    });

    it("US-2: сплит пустой области — no-op без ошибок", () => {
        h.commands.execute("workbench.action.splitEditor");
        expect(service().groups.length).toBe(1);
    });

    it("US-8: не влезаем — сплит молча отклонён, полоса не изменилась", () => {
        h.dispose();
        // 30 колонок: 2 группы × 20 минимум не помещаются.
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(30, 20) });
        h.workbench.openFile(ws.path("alpha.txt"));

        h.commands.execute("workbench.action.splitEditor");

        expect(service().groups.length).toBe(1);
    });

    it("US-9: фокус группы по номеру (команды First/Second)", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        expect(service().viewColumnOf(service().activeGroup)).toBe(2);

        h.commands.execute("workbench.action.focusFirstEditorGroup");
        expect(service().viewColumnOf(service().activeGroup)).toBe(1);

        h.commands.execute("workbench.action.focusSecondEditorGroup");
        expect(service().viewColumnOf(service().activeGroup)).toBe(2);
    });

    it("US-10: фокус по направлению; за краем полосы — no-op", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");

        h.commands.execute("workbench.action.focusLeftGroup");
        expect(service().viewColumnOf(service().activeGroup)).toBe(1);
        // Слева края — остаёмся на месте.
        h.commands.execute("workbench.action.focusLeftGroup");
        expect(service().viewColumnOf(service().activeGroup)).toBe(1);

        h.commands.execute("workbench.action.focusRightGroup");
        expect(service().viewColumnOf(service().activeGroup)).toBe(2);
        h.commands.execute("workbench.action.focusRightGroup");
        expect(service().viewColumnOf(service().activeGroup)).toBe(2);
        // Поперёк оси (полоса колоночная) — no-op.
        h.commands.execute("workbench.action.focusAboveGroup");
        expect(service().viewColumnOf(service().activeGroup)).toBe(2);
    });

    it("US-11: navigateEditorGroups обходит полосу по кругу", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.commands.execute("workbench.action.focusFirstEditorGroup");

        h.commands.execute("workbench.action.navigateEditorGroups");
        expect(service().viewColumnOf(service().activeGroup)).toBe(2);
        h.commands.execute("workbench.action.navigateEditorGroups");
        expect(service().viewColumnOf(service().activeGroup)).toBe(1);
    });

    it("US-12: группа помнит активную вкладку и каретку при переключениях", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        // Группа 2: открываем второй файл — активная вкладка в ней меняется.
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
        // Группа 1: alpha + beta; сплит от beta; группа 2: beta(копия) + gamma.
        h.workbench.openFile(ws.path("alpha.txt"));
        h.workbench.openFile(ws.path("beta.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.workbench.openFile(ws.path("gamma.txt"));

        const groups = service().groups;
        expect(groups[0].editorCount).toBe(2);
        expect(groups[1].editorCount).toBe(2);

        h.commands.execute("workbench.action.focusFirstEditorGroup");
        service().cycleMru(1);
        service().endMruCycle();

        // Активная группа не изменилась, вкладка сменилась внутри неё.
        expect(service().viewColumnOf(service().activeGroup)).toBe(1);
        expect(service().getActiveEditor()!.uri.path.endsWith("alpha.txt")).toBe(true);
        // Группа 2 осталась на gamma.
        expect(groups[1].activePane!.uri.path.endsWith("gamma.txt")).toBe(true);
    });

    it("US-14: фокус в поддереве группы делает её активной (клик мышью)", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        const groups = service().groups;
        expect(service().activeGroup === groups[1]).toBe(true);

        // Клик в текст группы 1 = фокус её редактора.
        groups[0].activePane!.focusEditor();

        expect(service().activeGroup === groups[0]).toBe(true);
    });

    it("US-16-механика: закрытие последней вкладки схлопывает группу, фокус — соседке", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        expect(service().groups.length).toBe(2);

        // В группе 2 одна вкладка — закрываем её.
        h.commands.execute("workbench.action.closeActiveEditor");

        expect(service().groups.length).toBe(1);
        expect(service().activeGroup === service().groups[0]).toBe(true);
        expect(service().getActiveEditor()!.uri.path.endsWith("alpha.txt")).toBe(true);
        const focused = h.testApp.focusedElement;
        expect(focused).not.toBeNull();
    });

    it("US-30: дедуп вкладок — пер-группный (общая модель, две вкладки)", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        const groups = service().groups;

        // Повторное открытие alpha в группе 2 — переключение, не новая вкладка.
        h.workbench.openFile(ws.path("alpha.txt"));
        expect(groups[1].editorCount).toBe(1);

        // Обе вкладки альфы делят одну модель.
        const left = groups[0].getPanes()[0];
        const right = groups[1].getPanes()[0];
        expect(left !== right).toBe(true);
        expect(
            (left as { model?: unknown }).model === (right as { model?: unknown }).model,
        ).toBe(true);
    });

    it("US-4: новая пустая группа фокусируема и принимает открытие файла", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.newGroupRight");

        const groups = service().groups;
        expect(groups.length).toBe(2);
        expect(groups[1].editorCount).toBe(0);
        expect(service().activeGroup === groups[1]).toBe(true);
        // Фокус — в филлере пустой группы.
        expect(h.testApp.focusedElement).not.toBeNull();

        // Открытие файла попадает в пустую активную группу.
        h.workbench.openFile(ws.path("beta.txt"));
        expect(groups[1].editorCount).toBe(1);
        expect(groups[1].activePane!.uri.path.endsWith("beta.txt")).toBe(true);
    });

    it("US-47: последняя вкладка последней группы — остаётся одна пустая группа", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.closeActiveEditor");

        expect(service().groups.length).toBe(1);
        expect(service().groups[0].editorCount).toBe(0);
    });

    it("направленный сплит поперёк оси: одна группа меняет ось, разложенная полоса — нет", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        // Одна группа: Split Down меняет ось на rows и сплитит.
        h.commands.execute("workbench.action.splitEditorDown");
        expect(service().groups.length).toBe(2);

        // Полоса рядная; Split Right поперёк — отклонён.
        h.commands.execute("workbench.action.splitEditorRight");
        expect(service().groups.length).toBe(2);
    });

    it("группы делят полосу поровну после сплита (лэйаут кадра)", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.testApp.render();

        const groups = service().groups;
        const leftView = groups[0].activePane!.view;
        const rightView = groups[1].activePane!.view;
        // Каждая вью стоит в своей половине полосы.
        expect(leftView.globalPosition.x).toBeLessThan(rightView.globalPosition.x);
        expect(Math.abs(leftView.layoutSize.width - rightView.layoutSize.width)).toBeLessThanOrEqual(1);
    });
});
