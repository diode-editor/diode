import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "../../../../tuidom/common/geometryPromitives.ts";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { resolveUserDataPaths } from "../../platform/environment/node/userDataPaths.ts";
import { loadState, StateService } from "../../platform/state/node/stateService.ts";
import { EDITOR_GROUPS_STATE, OPEN_EDITORS_STATE } from "../common/stateKeys.ts";
import { EditorServiceDIToken } from "../services/editor/browser/editorService.ts";

/**
 * End-to-end персистентность сессии: открыть файлы + поменять layout в одном
 * «запуске», сбросить на диск, поднять новый Workbench на том же воркспейсе и
 * убедиться, что всё восстановилось. Общий на два запуска — реальный
 * `StateService` поверх одного каталога user-data.
 */
describe("Workbench — session state persistence", () => {
    let ws: ITempWorkspace;
    let userData: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "vexx-persist-ws-", files: { "a.ts": "A", "b.ts": "B", "c.ts": "C" } });
        userData = createTempWorkspace({ prefix: "vexx-persist-home-" });
    });

    afterEach(() => {
        ws.dispose();
        userData.dispose();
    });

    function newState(): StateService {
        return loadState(resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir }));
    }

    it("restores open files, active tab, sidebar width and panel state across a restart", () => {
        // ── Запуск 1: пользователь настроил рабочее место ───────────────────
        const state1 = newState();
        const h1: IAppHarness = createAppTestHarness({ workspaceFolder: ws.dir, stateService: state1 });
        h1.workbench.openFile(ws.path("a.ts"));
        h1.workbench.openFile(ws.path("b.ts"));
        h1.workbench.openFile(ws.path("c.ts"));
        // Активной делаем среднюю вкладку.
        h1.container.get(EditorServiceDIToken).activateTab(1);
        h1.workbench.workbenchLayout.setLeftPanelWidth(45);
        h1.workbench.workbenchLayout.setBottomPanelVisible(true);
        h1.workbench.workbenchLayout.setBottomPanelHeight(8);
        state1.flushSync();
        h1.dispose();

        // ── Запуск 2: свежий Workbench на том же воркспейсе ──────────────
        const state2 = newState();
        const h2: IAppHarness = createAppTestHarness({ workspaceFolder: ws.dir, stateService: state2 });
        h2.workbench.restoreOpenEditors(); // main.ts вызывает это, когда в CLI нет файлов

        const group = h2.container.get(EditorServiceDIToken);
        expect(group.getOpenFilePaths()).toEqual([ws.path("a.ts"), ws.path("b.ts"), ws.path("c.ts")]);
        expect(group.activeIndex).toBe(1);
        expect(h2.workbench.workbenchLayout.getLeftPanelWidth()).toBe(45);
        expect(h2.workbench.workbenchLayout.getBottomPanelVisible()).toBe(true);
        expect(h2.workbench.workbenchLayout.getBottomPanelHeight()).toBe(8);
        h2.dispose();
    });

    // Бутстрап спрашивает пути ДО открытия, чтобы успеть прогреть их грамматики:
    // подсветка должна быть уже в первом кадре вкладки.
    it("reports the files restoreOpenEditors() will open — before opening them", () => {
        const state1 = newState();
        const h1: IAppHarness = createAppTestHarness({ workspaceFolder: ws.dir, stateService: state1 });
        h1.workbench.openFile(ws.path("a.ts"));
        h1.workbench.openFile(ws.path("b.ts"));
        state1.flushSync();
        h1.dispose();

        const state2 = newState();
        const h2: IAppHarness = createAppTestHarness({ workspaceFolder: ws.dir, stateService: state2 });

        // Ещё ничего не открыто, но список уже известен.
        expect(h2.container.get(EditorServiceDIToken).getOpenFilePaths()).toEqual([]);
        expect(h2.workbench.getOpenEditorsToRestore()).toEqual([ws.path("a.ts"), ws.path("b.ts")]);

        // И он совпадает с тем, что реально откроется.
        h2.workbench.restoreOpenEditors();
        expect(h2.container.get(EditorServiceDIToken).getOpenFilePaths()).toEqual([ws.path("a.ts"), ws.path("b.ts")]);
        h2.dispose();
    });

    it("US-41: восстанавливает полосу групп — состав, активные вкладки, активную группу, ось и доли", () => {
        // ── Запуск 1: две группы с разным содержимым и подвинутым сашем ─────
        const state1 = newState();
        const h1: IAppHarness = createAppTestHarness({
            workspaceFolder: ws.dir,
            stateService: state1,
            size: new Size(140, 40),
        });
        h1.workbench.openFile(ws.path("a.ts"));
        h1.workbench.openFile(ws.path("b.ts"));
        h1.commands.execute("workbench.action.splitEditor"); // группа 2: копия b
        h1.workbench.openFile(ws.path("c.ts")); // группа 2: b + c
        h1.commands.execute("workbench.action.increaseEditorWidth");
        h1.commands.execute("workbench.action.focusFirstEditorGroup");
        h1.container.get(EditorServiceDIToken).activateTab(0); // группа 1: активна a
        state1.flushSync();
        const weightsBefore = [
            ...(h1.workbench as unknown as { editorPartComponent: { weights: readonly number[] } })
                .editorPartComponent.weights,
        ];
        h1.dispose();

        // ── Запуск 2: полоса поднимается целиком ────────────────────────────
        const state2 = newState();
        const h2: IAppHarness = createAppTestHarness({
            workspaceFolder: ws.dir,
            stateService: state2,
            size: new Size(140, 40),
        });
        h2.workbench.restoreOpenEditors();

        const service = h2.container.get(EditorServiceDIToken);
        expect(service.groups.length).toBe(2);
        expect(service.groups[0].getPanes().map((p) => p.uri.fsPath)).toEqual([ws.path("a.ts"), ws.path("b.ts")]);
        expect(service.groups[1].getPanes().map((p) => p.uri.fsPath)).toEqual([ws.path("b.ts"), ws.path("c.ts")]);
        expect(service.groups[0].activePane!.uri.fsPath).toBe(ws.path("a.ts"));
        expect(service.groups[1].activePane!.uri.fsPath).toBe(ws.path("c.ts"));
        // Активная группа — первая (как перед выходом).
        expect(service.activeGroup === service.groups[0]).toBe(true);
        // Доли пережили рестарт (саш был сдвинут resize-командой).
        const part = (h2.workbench as unknown as { editorPartComponent: { weights: readonly number[] } })
            .editorPartComponent;
        expect(part.weights.map((w) => w.toFixed(3))).toEqual(weightsBefore.map((w) => w.toFixed(3)));
        h2.dispose();
    });

    it("US-42: пропавший файл пропускается; опустевшая группа схлопывается при ресторе", () => {
        const state1 = newState();
        const h1: IAppHarness = createAppTestHarness({
            workspaceFolder: ws.dir,
            stateService: state1,
            size: new Size(140, 40),
        });
        h1.workbench.openFile(ws.path("a.ts"));
        h1.commands.execute("workbench.action.newGroupRight");
        h1.workbench.openFile(ws.path("b.ts")); // единственный файл группы 2
        state1.flushSync();
        h1.dispose();

        fs.rmSync(ws.path("b.ts"));

        const state2 = newState();
        const h2: IAppHarness = createAppTestHarness({
            workspaceFolder: ws.dir,
            stateService: state2,
            size: new Size(140, 40),
        });
        h2.workbench.restoreOpenEditors();

        const service = h2.container.get(EditorServiceDIToken);
        expect(service.groups.length).toBe(1);
        expect(service.groups[0].getPanes().map((p) => p.uri.fsPath)).toEqual([ws.path("a.ts")]);
        h2.dispose();
    });

    it("US-43: рестор в маленьком терминале сливает лишние группы, файлы не теряются", () => {
        const state1 = newState();
        const h1: IAppHarness = createAppTestHarness({
            workspaceFolder: ws.dir,
            stateService: state1,
            size: new Size(140, 40),
        });
        h1.workbench.openFile(ws.path("a.ts"));
        h1.commands.execute("workbench.action.newGroupRight");
        h1.workbench.openFile(ws.path("b.ts"));
        state1.flushSync();
        h1.dispose();

        // 50 колонок: сайдбар 30 + область ~20 — две группы по 20 не влезают.
        const state2 = newState();
        const h2: IAppHarness = createAppTestHarness({
            workspaceFolder: ws.dir,
            stateService: state2,
            size: new Size(50, 24),
        });
        h2.workbench.restoreOpenEditors();

        const service = h2.container.get(EditorServiceDIToken);
        expect(service.groups.length).toBe(1);
        expect(service.groups[0].getPanes().map((p) => p.uri.fsPath)).toEqual([ws.path("a.ts"), ws.path("b.ts")]);
        h2.dispose();
    });

    it("getOpenEditorsToRestore дедупит файл, открытый в двух группах", () => {
        const state1 = newState();
        const h1: IAppHarness = createAppTestHarness({
            workspaceFolder: ws.dir,
            stateService: state1,
            size: new Size(140, 40),
        });
        h1.workbench.openFile(ws.path("a.ts"));
        h1.commands.execute("workbench.action.splitEditor"); // группа 2: копия a
        h1.workbench.openFile(ws.path("b.ts"));
        state1.flushSync();
        h1.dispose();

        const state2 = newState();
        const h2: IAppHarness = createAppTestHarness({
            workspaceFolder: ws.dir,
            stateService: state2,
            size: new Size(140, 40),
        });
        // a.ts живёт в обеих группах — прогреву грамматик он нужен один раз.
        expect(h2.workbench.getOpenEditorsToRestore()).toEqual([ws.path("a.ts"), ws.path("b.ts")]);
        h2.dispose();
    });

    it("сессия до сплитов (плоский ключ) поднимается одной группой", () => {
        // Пишем ТОЛЬКО плоский ключ — как это делала сборка до сплитов.
        const state1 = newState();
        state1.openWorkspace(ws.dir);
        state1.store(OPEN_EDITORS_STATE, { files: [ws.path("a.ts"), ws.path("c.ts")], activeIndex: 1 });
        state1.flushSync();

        const state2 = newState();
        const h2: IAppHarness = createAppTestHarness({ workspaceFolder: ws.dir, stateService: state2 });
        h2.workbench.restoreOpenEditors();

        const service = h2.container.get(EditorServiceDIToken);
        expect(service.groups.length).toBe(1);
        expect(service.getOpenFilePaths()).toEqual([ws.path("a.ts"), ws.path("c.ts")]);
        expect(service.activeIndex).toBe(1);
        h2.dispose();
    });

    it("битый снимок групп: недостающая доля становится 1, вместо удалённой активной вкладки — первая", () => {
        // Снимок пишем руками: доли короче списка групп (такое оставляет старая
        // сборка или рука в JSON), активный файл группы 2 удалён с диска.
        const state1 = newState();
        state1.openWorkspace(ws.dir);
        state1.store(EDITOR_GROUPS_STATE, {
            orientation: "columns",
            groups: [
                { files: [ws.path("a.ts")], activeIndex: 0 },
                { files: [ws.path("b.ts"), ws.path("a.ts"), ws.path("c.ts")], activeIndex: 0 },
            ],
            weights: [0.5], // доля второй группы потеряна
            activeGroup: 1,
        });
        state1.flushSync();
        fs.rmSync(ws.path("b.ts")); // активный файл группы 2 исчез

        const state2 = newState();
        const h2: IAppHarness = createAppTestHarness({
            workspaceFolder: ws.dir,
            stateService: state2,
            size: new Size(140, 40),
        });
        h2.workbench.restoreOpenEditors();

        const service = h2.container.get(EditorServiceDIToken);
        expect(service.groups.length).toBe(2);
        // b.ts выпал; активной группы 2 стала ПЕРВАЯ уцелевшая вкладка, а не
        // последняя открытая.
        expect(service.groups[1].getPanes().map((p) => p.uri.fsPath)).toEqual([ws.path("a.ts"), ws.path("c.ts")]);
        expect(service.groups[1].activePane!.uri.fsPath).toBe(ws.path("a.ts"));
        // Потерянная доля добита единицей: после нормировки группа 2 шире первой.
        const part = (h2.workbench as unknown as { editorPartComponent: { weights: readonly number[] } })
            .editorPartComponent;
        expect(part.weights[1]).toBeGreaterThan(part.weights[0]);
        h2.dispose();
    });

    it("keeps state independent per workspace folder", () => {
        const ws2 = createTempWorkspace({ prefix: "vexx-persist-ws2-", files: { "z.ts": "Z" } });
        try {
            const state1 = newState();
            const a = createAppTestHarness({ workspaceFolder: ws.dir, stateService: state1 });
            a.workbench.openFile(ws.path("a.ts"));
            a.workbench.workbenchLayout.setLeftPanelWidth(50);
            state1.flushSync();
            a.dispose();

            // Другой воркспейс не наследует ни файлы, ни ширину первого.
            const state2 = newState();
            const b = createAppTestHarness({ workspaceFolder: ws2.dir, stateService: state2 });
            b.workbench.restoreOpenEditors();
            expect(b.container.get(EditorServiceDIToken).getOpenFilePaths()).toEqual([]);
            expect(b.workbench.workbenchLayout.getLeftPanelWidth()).toBe(30); // default
            b.dispose();
        } finally {
            ws2.dispose();
        }
    });
});
