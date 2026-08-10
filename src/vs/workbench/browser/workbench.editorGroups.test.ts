import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Point, Size } from "../../../../tuidom/common/geometryPromitives.ts";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";

import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { FindComponentDIToken } from "../contrib/find/browser/findComponent.ts";
import { DialogServiceDIToken } from "../services/dialogs/browser/dialogService.ts";
import { EditorServiceDIToken } from "../services/editor/browser/editorService.ts";

import { EditorPartComponentDIToken } from "./parts/editor/editorPartComponent.ts";
import { WorkbenchContextKeysDIToken } from "./workbenchContextKeys.ts";

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

    it("повторный dispose подписок сервиса групп — no-op, чужие слушатели живы", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        let activeFired = 0;
        let groupsFired = 0;
        const activeFirst = service().onDidActiveGroupChange(() => {});
        service().onDidActiveGroupChange(() => activeFired++);
        const groupsFirst = service().onDidGroupsChange(() => {});
        service().onDidGroupsChange(() => groupsFired++);

        activeFirst.dispose();
        activeFirst.dispose(); // indexOf === -1 — второй слушатель не снят
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

        // Первая строка нижней группы — её таб-стрип; раньше саш ложился поверх
        // и, будучи последним в hit-test, забирал точку себе (табы недоступны).
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

    it("US-35: статус-бар следует за активной группой (Ln/Col из её редактора)", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        // Группа 2: каретка на 21-й строке (1-based в статус-баре).
        service().getActiveEditor()!.viewState.goToPosition(20, 5);
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("Ln 21, Col 6");

        // Группа 1: каретка осталась на 41-й строке из US-1-подобного сетапа.
        h.commands.execute("workbench.action.focusFirstEditorGroup");
        service().getActiveEditor()!.viewState.goToPosition(2, 0);
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("Ln 3, Col 1");

        // Переключение группы без движения каретки — статус-бар пересчитан.
        h.commands.execute("workbench.action.focusSecondEditorGroup");
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("Ln 21, Col 6");
    });

    it("US-37: сквиглы диагностик приходят в обе вью документа", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        const groups = service().groups;
        // getEditors() — шов диагностик: обязан отдавать вкладки ВСЕХ групп.
        const editors = service().getEditors();
        expect(editors.length).toBe(2);
        expect(service().groupOf(editors[0]) === groups[0]).toBe(true);
        expect(service().groupOf(editors[1]) === groups[1]).toBe(true);
    });

    it("US-38: фокус в панели не меняет активную группу; focusActiveEditorGroup возвращает", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        const active = service().activeGroup;

        h.commands.execute("workbench.action.togglePanel");
        h.testApp.render();
        expect(service().activeGroup === active).toBe(true);

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
        expect(service().groups.length).toBe(1);
        expect(service().groupOf(detached)).toBeNull();
        expect(service().getPanes().includes(detached)).toBe(false);
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

        const groups = service().groups;
        const leftView = groups[0].activePane!.view;
        const rightView = groups[1].activePane!.view;
        // Каждая вью стоит в своей половине полосы.
        expect(leftView.globalPosition.x).toBeLessThan(rightView.globalPosition.x);
        expect(Math.abs(leftView.layoutSize.width - rightView.layoutSize.width)).toBeLessThanOrEqual(1);
    });

    it("US-3: Split Editor Left — новая группа с копией вкладки встаёт слева от источника", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        const source = service().activeGroup;

        h.commands.execute("workbench.action.splitEditorLeft");

        expect(service().groups.length).toBe(2);
        // Новая (активная) группа — в колонке 1, источник сдвинулся во 2-ю.
        expect(service().viewColumnOf(service().activeGroup)).toBe(1);
        expect(service().viewColumnOf(source)).toBe(2);
        expect(service().getActiveEditor()!.uri.path.endsWith("alpha.txt")).toBe(true);
    });

    it("US-3: Split Editor Up — единственная группа меняет ось, копия сверху", () => {
        h.workbench.openFile(ws.path("alpha.txt"));

        h.commands.execute("workbench.action.splitEditorUp");
        h.testApp.render();

        const groups = service().groups;
        expect(groups.length).toBe(2);
        expect(service().viewColumnOf(service().activeGroup)).toBe(1);
        // Полоса стала рядной: новая группа над источником.
        const top = groups[0].activePane!.view;
        const bottom = groups[1].activePane!.view;
        expect(top.globalPosition.y).toBeLessThan(bottom.globalPosition.y);
    });

    it("US-4: newGroup по направлениям — вдоль оси создаётся, поперёк разложенной полосы отказ", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditorDown"); // полоса rows

        h.commands.execute("workbench.action.newGroupBelow");
        expect(service().groups.length).toBe(3);
        expect(service().activeGroup.editorCount).toBe(0);

        h.commands.execute("workbench.action.newGroupAbove");
        expect(service().groups.length).toBe(4);

        // Колоночные варианты поперёк рядной полосы — молчаливый отказ.
        h.commands.execute("workbench.action.newGroupLeft");
        expect(service().groups.length).toBe(4);
    });

    it("US-4: New Group Left в колоночной полосе — пустая группа слева", () => {
        h.workbench.openFile(ws.path("alpha.txt"));

        h.commands.execute("workbench.action.newGroupLeft");

        const groups = service().groups;
        expect(groups.length).toBe(2);
        expect(service().activeGroup === groups[0]).toBe(true);
        expect(groups[0].editorCount).toBe(0);
        expect(groups[1].editorCount).toBe(1);
    });

    it("US-10: focusAbove/BelowGroup ходят по рядной полосе", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditorDown");
        expect(service().viewColumnOf(service().activeGroup)).toBe(2);

        h.commands.execute("workbench.action.focusAboveGroup");
        expect(service().viewColumnOf(service().activeGroup)).toBe(1);

        h.commands.execute("workbench.action.focusBelowGroup");
        expect(service().viewColumnOf(service().activeGroup)).toBe(2);
    });

    it("US-9: фокус по номеру за краем полосы — no-op (Ctrl+K 5 при двух группах)", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");

        h.commands.execute("workbench.action.focusFifthEditorGroup");

        expect(service().viewColumnOf(service().activeGroup)).toBe(2);
    });

    it("focusGroup по id схлопнутой группы — no-op (протухшая ссылка)", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        const dead = service().activeGroup;
        dead.closeTab(0); // группа схлопнулась

        service().focusGroup(dead.id);

        expect(service().groups.length).toBe(1);
        expect(service().activeGroup === service().groups[0]).toBe(true);
    });

    it("сплит безымянного буфера: untitled не дублируется, новая группа пустая", () => {
        service().newUntitled();
        const untitledView = h.testApp.focusedElement;

        const group = service().splitActiveGroup();

        expect(group).not.toBeNull();
        expect(group!.editorCount).toBe(0);
        expect(service().activeGroup === group).toBe(true);
        // Активного редактора нет — фасад отдаёт null (фокус в филлере).
        expect(service().getActiveEditor()).toBeNull();

        // Вариант без фокуса (рестор/программные вызовы): фокус не трогается.
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
        // 30 колонок: 2 группы × 20 минимум не помещаются.
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(30, 20) });
        h.workbench.openFile(ws.path("alpha.txt"));
        h.workbench.openFile(ws.path("beta.txt"));

        // Пустая группа не влезает.
        h.commands.execute("workbench.action.newGroupRight");
        expect(service().groups.length).toBe(1);

        // Перенос у единственной группы хочет создать соседку — отказ, вкладка на месте.
        h.commands.execute("workbench.action.moveEditorToNextGroup");
        expect(service().groups.length).toBe(1);
        expect(service().activeGroup.editorCount).toBe(2);

        // Открытие beside деградирует в активную группу.
        service().openFile(ws.path("gamma.txt"), { group: "beside" });
        expect(service().groups.length).toBe(1);
        expect(service().getActiveEditor()!.uri.path.endsWith("gamma.txt")).toBe(true);
    });

    it("перенос/копия за краем полосы — no-op", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor"); // активна группа 2 (правый край)
        h.workbench.openFile(ws.path("beta.txt"));

        h.commands.execute("workbench.action.moveEditorToNextGroup");
        expect(service().groups.length).toBe(2);
        expect(service().activeGroup.editorCount).toBe(2);

        h.commands.execute("workbench.action.copyEditorToNextGroup");
        expect(service().groups.length).toBe(2);
        expect(service().activeGroup.editorCount).toBe(2);
    });

    it("перенос из пустой группы — no-op", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.newGroupRight"); // активная — пустая

        service().moveActiveEditorToGroup("previous");

        expect(service().groups.length).toBe(2);
        expect(service().groups[0].editorCount).toBe(1);
    });

    it("US-50-зеркало: перенос против хода у единственной группы создаёт соседку слева", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.workbench.openFile(ws.path("beta.txt"));

        h.commands.execute("workbench.action.moveEditorToPreviousGroup");

        const groups = service().groups;
        expect(groups.length).toBe(2);
        expect(service().viewColumnOf(service().activeGroup)).toBe(1);
        expect(service().activeGroup.activePane!.uri.path.endsWith("beta.txt")).toBe(true);
        expect(groups[1].editorCount).toBe(1);
    });

    it("US-17-зеркало: дублирование в предыдущую группу; ресурс уже там — просто активация", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor"); // группа 2: копия alpha (активна)

        h.commands.execute("workbench.action.copyEditorToPreviousGroup");

        const groups = service().groups;
        // alpha уже есть в группе 1 — новой вкладки нет, активирована существующая.
        expect(groups[0].editorCount).toBe(1);
        expect(service().activeGroup === groups[0]).toBe(true);
        expect(service().getActiveEditor()!.uri.path.endsWith("alpha.txt")).toBe(true);
    });

    it("копия безымянного буфера не делается (нет общего файла)", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        service().newUntitled(); // группа 2: alpha + Untitled-1 (активен)

        h.commands.execute("workbench.action.copyEditorToPreviousGroup");

        expect(service().groups[0].editorCount).toBe(1); // только alpha
        expect(service().activeGroup === service().groups[1]).toBe(true);
    });

    it("US-18-зеркало: перестановка группы вправо; у края — no-op", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.commands.execute("workbench.action.focusFirstEditorGroup");
        const moved = service().activeGroup;

        h.commands.execute("workbench.action.moveActiveEditorGroupRight");
        expect(service().viewColumnOf(moved)).toBe(2);

        h.commands.execute("workbench.action.moveActiveEditorGroupRight");
        expect(service().viewColumnOf(moved)).toBe(2);
    });

    it("US-20: joinTwoGroups вливает следующую группу; единственная группа — no-op", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        // Соседа нет — выход без изменений.
        h.commands.execute("workbench.action.joinTwoGroups");
        expect(service().groups.length).toBe(1);

        h.commands.execute("workbench.action.splitEditor"); // группа 2: копия alpha
        h.workbench.openFile(ws.path("beta.txt")); // группа 2: alpha + beta
        h.commands.execute("workbench.action.focusFirstEditorGroup");

        h.commands.execute("workbench.action.joinTwoGroups");

        const groups = service().groups;
        expect(groups.length).toBe(1);
        // alpha (дубликат схлопнут) + beta.
        expect(groups[0].editorCount).toBe(2);
    });

    it("US-20: joinTwoGroups с пустым соседом просто схлопывает его", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.newGroupRight"); // пустая группа 2
        h.commands.execute("workbench.action.focusFirstEditorGroup");

        h.commands.execute("workbench.action.joinTwoGroups");

        expect(service().groups.length).toBe(1);
        expect(service().groups[0].editorCount).toBe(1);
    });

    it("US-21: joinAllGroups при пустой активной группе — вспоминать нечего, полоса сливается", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.newGroupRight"); // активная — пустая

        h.commands.execute("workbench.action.joinAllGroups");

        expect(service().groups.length).toBe(1);
        expect(service().groups[0].editorCount).toBe(1);
    });

    it("editorLayoutSingle сводит полосу к одной колонке; повторный вызов — no-op", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");

        h.commands.execute("workbench.action.editorLayoutSingle");
        expect(service().groups.length).toBe(1);

        h.commands.execute("workbench.action.editorLayoutSingle");
        expect(service().groups.length).toBe(1);
    });

    it("US-23: resize поперёк оси полосы — no-op (высота в колоночной полосе)", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.testApp.render();
        const before = service().groups[1].activePane!.view.layoutSize.height;

        h.commands.execute("workbench.action.increaseEditorHeight");
        h.testApp.render();

        expect(service().groups[1].activePane!.view.layoutSize.height).toBe(before);
    });

    it("US-19: повторный тумблер оси возвращает колоночную полосу", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");

        h.commands.execute("workbench.action.toggleEditorGroupLayout"); // rows
        h.commands.execute("workbench.action.toggleEditorGroupLayout"); // обратно columns
        h.testApp.render();

        const groups = service().groups;
        const left = groups[0].activePane!.view;
        const right = groups[1].activePane!.view;
        expect(left.globalPosition.x).toBeLessThan(right.globalPosition.x);
        expect(left.globalPosition.y).toBe(right.globalPosition.y);
    });

    it("US-24: максимизация переезжает за сменой активной группы", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.testApp.render();

        h.commands.execute("workbench.action.toggleMaximizeEditorGroup"); // максимизирована группа 2
        h.testApp.render();
        h.commands.execute("workbench.action.focusFirstEditorGroup");
        h.testApp.render();

        const groups = service().groups;
        const part = h.testApp.querySelector("EditorPartElement")!;
        // Теперь всю часть занимает группа 1, группа 2 скрыта.
        expect(groups[0].activePane!.view.layoutSize.width).toBe(part.layoutSize.width);
        expect(groups[1].activePane!.view.getAncestorPath().some((el) => el.hidden)).toBe(true);
    });

    it("groupOverlayHost схлопнутой группы — null", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        const collapsed = service().activeGroup;
        const part = h.container.get(EditorPartComponentDIToken);
        expect(part.groupOverlayHost(collapsed.id)).not.toBeNull();

        collapsed.closeTab(0); // группа схлопнулась

        expect(part.groupOverlayHost(collapsed.id)).toBeNull();
    });

    it("US-16: Close Editor Group закрывает вкладки и схлопывает группу", async () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.workbench.openFile(ws.path("beta.txt")); // группа 2: alpha + beta

        h.commands.execute("workbench.action.closeEditorsAndGroup");
        await vi.waitFor(() => {
            expect(service().groups.length).toBe(1);
        });

        expect(service().groups[0].editorCount).toBe(1);
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

        dialogs.getOpenConfirmSaveDialog()!.onCancel?.();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(service().activeGroup.editorCount).toBe(1);
        expect(editor.isModified).toBe(true);
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
            expect(service().activeGroup.editorCount).toBe(0);
        });

        expect(fs.readFileSync(ws.path("beta.txt"), "utf8")).toContain("saved!");
    });

    it("US-22: Close All Editors обходит все группы; пустая активная не мешает", async () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        h.workbench.openFile(ws.path("beta.txt")); // группа 2: alpha + beta
        h.commands.execute("workbench.action.newGroupRight"); // активная — пустая группа 3

        h.commands.execute("workbench.action.closeAllEditors");
        await vi.waitFor(() => {
            expect(service().groups.length).toBe(1);
        });

        expect(service().groups[0].editorCount).toBe(0);
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

        expect(service().groups[0].editorCount).toBe(1);
        expect(service().getActiveEditor()!.isModified).toBe(true);
    });

    it("US-49: collectDirty дедуплицирует документ, открытый в двух группах", () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute("workbench.action.splitEditor");
        service().getActiveEditor()!.viewState.type("dirty!");

        // Обе вкладки показывают одну модель — диалог при выходе один.
        expect(service().collectDirty().length).toBe(1);
    });

    it("US-5: Open to the Side из дерева; без выделенного файла — no-op", async () => {
        h.workbench.openFile(ws.path("alpha.txt"));
        // Дерево ещё не активировано — выделенного файла нет, команда молчит.
        h.commands.execute("explorer.openToSide");
        expect(service().groups.length).toBe(1);

        await h.workbench.activate();
        h.testApp.render();
        const tree = h.testApp.querySelector("TreeViewElement")!;
        tree.focus();
        h.testApp.render();

        // Курсор дерева — на первом файле (alpha.txt).
        h.commands.execute("explorer.openToSide");

        expect(service().groups.length).toBe(2);
        expect(service().viewColumnOf(service().activeGroup)).toBe(2);
        expect(service().getActiveEditor()!.uri.path.endsWith("alpha.txt")).toBe(true);
    });
});
