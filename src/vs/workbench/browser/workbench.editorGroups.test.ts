import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "../../../../tuidom/common/geometryPromitives.ts";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";

import { FindComponentDIToken } from "../contrib/find/browser/findComponent.ts";
import { DialogServiceDIToken } from "../services/dialogs/browser/dialogService.ts";
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

    it("US-15: перенос вкладки в соседнюю группу — фокус едет со вкладкой", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.workbench.openFile(ws.path("beta.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.commands.execute("workbench.action.focusFirstEditorGroup");
        // Активная вкладка группы 1 — beta (копия в группе 2 тоже beta).
        const groups = service().groups;
        expect(groups[0].activePane!.uri.path.endsWith("beta.txt")).toBe(true);

        h.commands.execute("workbench.action.moveEditorToNextGroup");

        // beta уже была в группе 2 → перенос слился с существующей вкладкой.
        expect(groups[0].editorCount).toBe(1);
        expect(groups[1].editorCount).toBe(1);
        expect(service().activeGroup === groups[1]).toBe(true);
        expect(service().getActiveEditor()!.uri.path.endsWith("beta.txt")).toBe(true);
    });

    it("US-50: перенос у единственной группы создаёт соседку", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.workbench.openFile(ws.path("beta.txt"));

        h.commands.execute("workbench.action.moveEditorToNextGroup");

        const groups = service().groups;
        expect(groups.length).toBe(2);
        expect(groups[0].editorCount).toBe(1);
        expect(groups[1].editorCount).toBe(1);
        expect(groups[1].activePane!.uri.path.endsWith("beta.txt")).toBe(true);
    });

    it("US-16: перенос последней вкладки схлопывает группу-источник", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        // Группа 2 (активная) держит копию alpha; в группе 1 открываем beta,
        // чтобы перенос не слился с копией.
        h.commands.execute("workbench.action.focusFirstEditorGroup");
        h.workbench.openFile(ws.path("beta.txt"));

        h.commands.execute("workbench.action.moveEditorToNextGroup");

        // Источник (группа 1: alpha осталась) жив; но перенесём и её.
        h.commands.execute("workbench.action.focusFirstEditorGroup");
        h.commands.execute("workbench.action.moveEditorToNextGroup");

        expect(service().groups.length).toBe(1);
        expect(service().groups[0].editorCount).toBe(2);
    });

    it("US-17: дублирование вкладки в соседнюю группу — общая модель", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.newGroupRight");
        h.commands.execute("workbench.action.focusFirstEditorGroup");

        h.commands.execute("workbench.action.copyEditorToNextGroup");

        const groups = service().groups;
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
        const movedGroup = service().activeGroup;
        expect(service().viewColumnOf(movedGroup)).toBe(2);

        h.commands.execute("workbench.action.moveActiveEditorGroupLeft");

        expect(service().viewColumnOf(movedGroup)).toBe(1);
        expect(service().activeGroup === movedGroup).toBe(true);
        // У края — no-op.
        h.commands.execute("workbench.action.moveActiveEditorGroupLeft");
        expect(service().viewColumnOf(movedGroup)).toBe(1);
    });

    it("US-21: joinAllGroups сливает всё в одну, дубликаты схлопнуты, активная вкладка выживает", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor"); // группа 2: копия alpha
        h.workbench.openFile(ws.path("beta.txt")); // группа 2: alpha + beta (активна beta)

        h.commands.execute("workbench.action.joinAllGroups");

        const groups = service().groups;
        expect(groups.length).toBe(1);
        // alpha (дубликат схлопнут) + beta.
        expect(groups[0].editorCount).toBe(2);
        expect(service().getActiveEditor()!.uri.path.endsWith("beta.txt")).toBe(true);
    });

    it("US-19: тумблер оси сохраняет группы и содержимое", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");

        h.commands.execute("workbench.action.toggleEditorGroupLayout");
        h.testApp.render();

        const groups = service().groups;
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

        const groups = service().groups;
        const leftView = groups[0].activePane!.view;
        const rightView = groups[1].activePane!.view;
        // Максимизированная группа занимает всю часть «область редактора».
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
        const groups = service().groups;
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

        service().openUri(service().getActiveEditor()!.uri, { group: "beside" });
        // Тот же ресурс beside: новая группа со второй вкладкой той же модели.
        expect(service().groups.length).toBe(2);
        expect(service().activeGroup === service().groups[1]).toBe(true);

        // Повторный beside из группы 1 переиспользует группу 2.
        h.commands.execute("workbench.action.focusFirstEditorGroup");
        service().openFile(ws.path("beta.txt"), { group: "beside" });
        expect(service().groups.length).toBe(2);
        expect(service().groups[1].editorCount).toBe(2);
    });

    it("US-48: Close All Editors in Group — диалог по изменённой, после ответа группа схлопнулась", async () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        // Группа 2: копия alpha (общая модель — правка через неё) + gamma.
        h.workbench.openFile(ws.path("gamma.txt"));
        const groups = service().groups;
        const alphaPane = groups[1].getPanes()[0];
        (alphaPane as { viewState: { type(t: string): unknown } }).viewState.type("dirty!");
        expect(alphaPane.isModified).toBe(true);

        h.commands.execute("workbench.action.closeEditorsInGroup");
        await new Promise((resolve) => setTimeout(resolve, 0));

        // gamma (чистая) закрыта сразу; alpha — copy: alpha открыта и в группе 1
        // (не последняя вкладка документа) → закрывается БЕЗ диалога; группа
        // схлопнулась без вопросов.
        const dialogs = h.container.get(DialogServiceDIToken);
        expect(dialogs.getOpenConfirmSaveDialog()).toBeNull();
        expect(service().groups.length).toBe(1);

        // Теперь единственная вкладка документа: диалог обязателен.
        h.commands.execute("workbench.action.closeEditorsInGroup");
        await new Promise((resolve) => setTimeout(resolve, 0));
        const dialog = dialogs.getOpenConfirmSaveDialog();
        expect(dialog).not.toBeNull();
        dialog!.onDontSave?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(service().groups[0].editorCount).toBe(0);
    });

    it("US-33: у каждой группы свой find-виджет с независимым запросом; Escape локален", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.testApp.render();
        const find = h.container.get(FindComponentDIToken);
        const groups = service().groups;

        // Find в группе 2 (активной) с запросом "line".
        h.commands.execute("actions.find");
        const widgetB = find.widgetFor(groups[1].id)!;
        widgetB.setQuery("line");
        widgetB.onQueryChange?.("line");
        expect(find.isOpen(groups[1].id)).toBe(true);

        // Переключение в группу 1 НЕ закрывает find группы 2 (пер-группные сессии).
        h.commands.execute("workbench.action.focusFirstEditorGroup");
        expect(find.isOpen(groups[1].id)).toBe(true);

        // Find в группе 1 — свой виджет со своим запросом.
        h.commands.execute("actions.find");
        const widgetA = find.widgetFor(groups[0].id)!;
        widgetA.setQuery("alpha-only");
        widgetA.onQueryChange?.("alpha-only");
        expect(find.isOpen(groups[0].id)).toBe(true);
        expect(widgetB.getQuery()).toBe("line");

        // Escape (закрытие) — только у активной группы.
        h.commands.execute("closeFindWidget");
        expect(find.isOpen(groups[0].id)).toBe(false);
        expect(find.isOpen(groups[1].id)).toBe(true);
    });

    it("схлопывание группы забирает её find-виджет и сессию", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.testApp.render();
        const find = h.container.get(FindComponentDIToken);
        const collapsedGroup = service().activeGroup;

        h.commands.execute("actions.find");
        expect(find.isOpen(collapsedGroup.id)).toBe(true);

        // Закрываем единственную вкладку — группа схлопывается вместе с виджетом.
        service().activeGroup.closeTab(0);
        expect(service().groups.length).toBe(1);
        expect(find.widgetIfExists(collapsedGroup.id)).toBeNull();
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
