import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";

import type { MruCycleState } from "./editorGroupModel.ts";
import { EditorService } from "./editorService.ts";

function createEditorService(): EditorService {
    return new EditorService(
        new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
        new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        NULL_LANGUAGE_SERVICE,
        NULL_CONFIGURATION_SERVICE,
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
        NULL_LOG_SERVICE,
    );
}

describe("EditorService — переключение вкладок (Ctrl+PgUp/PgDn и события серии Ctrl+Tab)", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-tabswitch-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function writeFile(name: string, content = name): string {
        const filePath = path.join(ws.dir, name);
        fs.writeFileSync(filePath, content, "utf-8");
        return filePath;
    }

    function openThree(ctrl: EditorService): void {
        ctrl.openFile(writeFile("a.ts"));
        ctrl.openFile(writeFile("b.ts"));
        ctrl.openFile(writeFile("c.ts"));
    }

    function activeName(ctrl: EditorService): string | null | undefined {
        return ctrl.getActiveEditor()?.fileName;
    }

    describe("cycleEditor — визуальный порядок, не MRU", () => {
        it("шаг вперёд идёт к следующей вкладке по позиции, с заворотом", () => {
            const ctrl = createEditorService();
            openThree(ctrl);
            const groupChanges: unknown[] = [];
            ctrl.onDidActiveGroupChange((group) => groupChanges.push(group));

            // Активна c (последняя). MRU-шаг увёл бы в b; визуальный — заворот на a.
            ctrl.cycleEditor(1);
            expect(activeName(ctrl)).toBe("a.ts");
            ctrl.cycleEditor(1);
            expect(activeName(ctrl)).toBe("b.ts");

            // Шаг внутри группы активную группу не трогает и её событий не шлёт.
            expect(groupChanges).toEqual([]);
        });

        it("шаг назад идёт к предыдущей по позиции, с заворотом на последнюю", () => {
            const ctrl = createEditorService();
            openThree(ctrl);
            ctrl.activateTab(0);
            ctrl.cycleEditor(-1);
            expect(activeName(ctrl)).toBe("c.ts");
        });

        it("каждый шаг коммитится в MRU сразу — без hold-сессии", () => {
            const ctrl = createEditorService();
            openThree(ctrl);
            ctrl.cycleEditor(1); // → a
            expect(ctrl.getMruOrder()[0]?.label).toBe("a.ts");
        });

        it("одна вкладка (и пустая полоса) — no-op", () => {
            const ctrl = createEditorService();
            ctrl.cycleEditor(1);
            expect(ctrl.getActiveEditor()).toBeNull();

            ctrl.openFile(writeFile("solo.ts"));
            ctrl.cycleEditor(1);
            ctrl.cycleEditor(-1);
            expect(activeName(ctrl)).toBe("solo.ts");
        });

        it("две вкладки — минимальный цикл уже работает (граница «меньше двух»)", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts"));
            ctrl.openFile(writeFile("b.ts"));
            ctrl.cycleEditor(1);
            expect(activeName(ctrl)).toBe("a.ts");
        });

        it("пересекает границу группы: после последней вкладки группы — первая следующей", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts"));
            ctrl.openFile(writeFile("b.ts"));
            const split = ctrl.splitActiveGroup();
            expect(split).not.toBeNull();
            // Полоса: g1 [a, b] · g2 [b]; активна g2:b (последняя вкладка полосы).
            const groupChanges: number[] = [];
            ctrl.onDidActiveGroupChange((group) => groupChanges.push(group.id));

            ctrl.cycleEditor(1);

            expect(ctrl.activeGroup).toBe(ctrl.groups[0]);
            expect(activeName(ctrl)).toBe("a.ts");
            expect(groupChanges).toHaveLength(1);
        });

        it("шаг назад из первой вкладки полосы уводит в последнюю вкладку последней группы", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts"));
            ctrl.openFile(writeFile("b.ts"));
            ctrl.splitActiveGroup();
            ctrl.notifyGroupFocused(ctrl.groups[0]);
            ctrl.activateTab(0); // g1:a — первая вкладка полосы

            ctrl.cycleEditor(-1);

            expect(ctrl.activeGroup).toBe(ctrl.groups[1]);
            expect(activeName(ctrl)).toBe("b.ts");
        });

        it("у пустой активной группы «вперёд» начинает с первой вкладки полосы, «назад» — с последней", () => {
            const ctrl = createEditorService();
            openThree(ctrl);
            ctrl.newGroup("after");
            expect(ctrl.activeGroup.editorCount).toBe(0);

            ctrl.cycleEditor(1);
            expect(activeName(ctrl)).toBe("a.ts");

            // Схлопнувшуюся пустую группу пересоздаём для обратного направления.
            ctrl.newGroup("after");
            ctrl.cycleEditor(-1);
            expect(activeName(ctrl)).toBe("c.ts");
        });
    });

    describe("onDidChangeMruCycle — фасад для оверлея переключателя", () => {
        function record(ctrl: EditorService): (MruCycleState | null)[] {
            const events: (MruCycleState | null)[] = [];
            ctrl.onDidChangeMruCycle((state) => events.push(state));
            return events;
        }

        it("шаг серии активной группы доходит до подписчика фасада", () => {
            const ctrl = createEditorService();
            openThree(ctrl);
            const events = record(ctrl);

            ctrl.cycleMru(1);

            expect(events).toHaveLength(1);
            expect(events[0]?.pointer).toBe(1);
            expect(events[0]?.panes.map((pane) => pane.label)).toEqual(["c.ts", "b.ts", "a.ts"]);
        });

        it("конец серии доходит null'ом; отписка снимает листенер", () => {
            const ctrl = createEditorService();
            openThree(ctrl);
            const events: (MruCycleState | null)[] = [];
            const subscription = ctrl.onDidChangeMruCycle((state) => events.push(state));

            ctrl.cycleMru(1);
            ctrl.endMruCycle();
            expect(events[1]).toBeNull();

            const others: (MruCycleState | null)[] = [];
            ctrl.onDidChangeMruCycle((state) => others.push(state));
            subscription.dispose();
            // Повторный dispose безвреден и НЕ трогает чужие подписки.
            subscription.dispose();
            ctrl.cycleMru(1);
            expect(events).toHaveLength(2);
            expect(others).toHaveLength(1);
        });

        it("серия группы, созданной сплитом ПОСЛЕ подписки, тоже форвардится", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts"));
            ctrl.openFile(writeFile("b.ts"));
            const events = record(ctrl);

            ctrl.splitActiveGroup();
            // Активная группа — новая (g2) с [b]; докидываем вторую вкладку для цикла.
            ctrl.openFile(writeFile("c.ts"));
            ctrl.cycleMru(1);

            expect(events.at(-1)).not.toBeNull();
            expect(events.at(-1)?.panes.map((pane) => pane.label)).toEqual(["c.ts", "b.ts"]);
        });

        it("уход фокуса в другую группу завершает серию прежней: null подписчику, выбор зафиксирован", () => {
            const ctrl = createEditorService();
            openThree(ctrl);
            ctrl.splitActiveGroup();
            ctrl.notifyGroupFocused(ctrl.groups[0]);
            const events = record(ctrl);

            ctrl.cycleMru(1); // серия в g1: c → b
            expect(events.at(-1)).not.toBeNull();

            ctrl.notifyGroupFocused(ctrl.groups[1]);

            expect(events.at(-1)).toBeNull();
            // Выбранная в серии вкладка (b) встала в начало MRU группы-источника.
            expect(ctrl.groups[0].getMruOrder()[0]?.label).toBe("b.ts");
        });

        it("кросс-групповой cycleEditor во время серии тоже завершает её null'ом", () => {
            const ctrl = createEditorService();
            openThree(ctrl);
            ctrl.splitActiveGroup();
            ctrl.notifyGroupFocused(ctrl.groups[0]);
            const events = record(ctrl);

            ctrl.cycleMru(1); // серия в g1
            ctrl.activateTab(0, { mru: true }); // остаёмся в серии, на первой вкладке полосы
            ctrl.cycleEditor(-1); // шаг назад через границу полосы — в g2

            // Кросс-групповой шаг завершил серию g1: последнее событие — null,
            // оверлей должен погаснуть, а активной стала последняя вкладка g2.
            expect(events.at(-1)).toBeNull();
            expect(ctrl.activeGroup).toBe(ctrl.groups[1]);
        });
    });
});
