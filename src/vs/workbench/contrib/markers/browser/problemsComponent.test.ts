import { Size } from "@tuidom/core/common/geometryPromitives";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IMarkerData } from "../../../../platform/markers/common/iMarker.ts";
import { MarkerSeverity } from "../../../../platform/markers/common/iMarker.ts";
import { MarkerService } from "../../../../platform/markers/common/markerService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { PanelComponent } from "../../../browser/parts/panel/panelComponent.ts";
import { PanelService } from "../../../browser/parts/panel/panelService.ts";
import type { IViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { NULL_JUMP_RECORDER } from "../../../services/history/browser/historyService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import {
    type IMarkerRevealEditor,
    PROBLEMS_UPDATE_DELAY_MS,
    PROBLEMS_VIEW_ID,
    ProblemsComponent,
} from "./problemsComponent.ts";
import type { ProblemNode } from "./problemsTreeDataProvider.ts";

const RESOURCE = "/ws/settings.json";

/** Дождаться, пока сведённые изменения маркеров дойдут до вкладки. */
const settleMarkers = (): Promise<void> => settle(PROBLEMS_UPDATE_DELAY_MS + 10);

function warning(message: string, line = 0): IMarkerData {
    return { severity: MarkerSeverity.Warning, range: createRange(line, 0, line, 3), message };
}

/** Reveal-цель-фейк: записывает открытия/переходы (структурная замена EditorService). */
function makeRevealTarget() {
    const editor = {
        uri: Uri.parse(RESOURCE),
        goToPosition: vi.fn(),
        revealRange: vi.fn(),
    };
    const state = { active: editor as IMarkerRevealEditor | null };
    return {
        editor,
        state,
        openUri: vi.fn<(uri: Uri) => Promise<void>>().mockResolvedValue(undefined),
        getActiveEditor: (): IMarkerRevealEditor | null => state.active,
    };
}

describe("ProblemsComponent", () => {
    let markerService: MarkerService;
    let views: IViewsHarness;
    let panelService: PanelService;
    let panelComponent: PanelComponent;
    let component: ProblemsComponent;
    let revealTarget: ReturnType<typeof makeRevealTarget>;
    let testApp: TestApp;

    beforeEach(() => {
        const themeService = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
        markerService = new MarkerService();
        views = makeViewsHarness();
        panelService = views.panelService;
        panelComponent = new PanelComponent(panelService, new CommandRegistry());
        revealTarget = makeRevealTarget();
        component = new ProblemsComponent(markerService, views.service, revealTarget, NULL_JUMP_RECORDER);
        // Контейнер PROBLEMS строит mount() workbench'а — здесь его роль.
        views.service.attachRegisteredContainers();
        testApp = TestApp.createWithContent(panelComponent.view, new Size(70, 12));
    });

    it("registers the PROBLEMS view and makes it the active tab", () => {
        expect(panelComponent.view.getViewIds()).toContain("workbench.panel.markers.view");
        expect(panelService.getActiveViewId()).toBe("workbench.panel.markers.view");
    });

    it("shows the placeholder (no view body) until markers appear, then the tree", async () => {
        // Маркеров нет → у view нет тела → секция рисует своё пустое состояние.
        expect(views.paneView(PROBLEMS_VIEW_ID).querySelector("#problemsView")).toBeNull();
        testApp.render();
        expect(testApp.backend.screenToString()).toContain("No problems have been detected in the workspace.");

        markerService.changeOne("settings", RESOURCE, [warning("Unknown Setting: x", 1)]);
        await settleMarkers();
        expect(views.paneView(PROBLEMS_VIEW_ID).querySelector("#problemsView")).toBe(component.view);

        testApp.render();
        const screen = testApp.backend.screenToString();
        expect(screen).toContain("settings.json");
        expect(screen).toContain("Unknown Setting: x");
        expect(screen).toContain("[Ln 2, Col 1]");
    });

    it("falls back to the placeholder when the markers clear", async () => {
        markerService.changeOne("settings", RESOURCE, [warning("x")]);
        await settleMarkers();
        expect(views.paneView(PROBLEMS_VIEW_ID).querySelector("#problemsView")).toBe(component.view);

        markerService.changeOne("settings", RESOURCE, []);
        await settleMarkers();
        expect(views.paneView(PROBLEMS_VIEW_ID).querySelector("#problemsView")).toBeNull();
    });

    it("reveals a marker's location through the reveal seam on activation", async () => {
        const markerNode: ProblemNode = {
            kind: "marker",
            resource: RESOURCE,
            marker: {
                owner: "settings",
                resource: RESOURCE,
                severity: MarkerSeverity.Warning,
                range: createRange(2, 2, 2, 7),
                message: "bad",
            },
            index: 0,
        };
        component.tree.onActivate?.(markerNode);
        // Открытие ресурса — обещание (недисковый идёт к провайдеру схемы),
        // поэтому переход каретки доезжает следующим тиком.
        await settle(0);

        expect(revealTarget.openUri).toHaveBeenCalledTimes(1);
        // Ресурс поднимается парсингом (не Uri.file) — см. комментарий в revealMarker.
        expect(revealTarget.openUri.mock.calls[0][0].toString()).toBe(Uri.parse(RESOURCE).toString());
        expect(revealTarget.editor.goToPosition).toHaveBeenCalledWith(2, 2);
        expect(revealTarget.editor.revealRange).toHaveBeenCalledWith(createRange(2, 2, 2, 7));
    });

    it("ресурс не открылся — каретку в ЧУЖОМ редакторе не двигаем", async () => {
        // Недисковый маркер (`jdt:`) без провайдера схемы: `openUri` вкладку не
        // заводит, активным остаётся прежний редактор. Двигать его каретку по
        // координатам чужого маркера нельзя.
        revealTarget.editor.uri = Uri.file("/ws/other.ts");
        const markerNode: ProblemNode = {
            kind: "marker",
            resource: RESOURCE,
            marker: {
                owner: "settings",
                resource: RESOURCE,
                severity: MarkerSeverity.Warning,
                range: createRange(2, 2, 2, 7),
                message: "bad",
            },
            index: 0,
        };

        component.tree.onActivate?.(markerNode);
        await settle(0);

        expect(revealTarget.openUri).toHaveBeenCalledTimes(1);
        expect(revealTarget.editor.goToPosition).not.toHaveBeenCalled();
        expect(revealTarget.editor.revealRange).not.toHaveBeenCalled();
    });

    it("редакторов нет вовсе — переход по маркеру не падает", async () => {
        // Недисковый маркер (`jdt:`) без провайдера схемы при пустой полосе
        // вкладок: `openUri` ничего не открыл, активного редактора нет.
        revealTarget.state.active = null;
        const markerNode: ProblemNode = {
            kind: "marker",
            resource: RESOURCE,
            marker: {
                owner: "settings",
                resource: RESOURCE,
                severity: MarkerSeverity.Warning,
                range: createRange(2, 2, 2, 7),
                message: "bad",
            },
            index: 0,
        };

        component.tree.onActivate?.(markerNode);
        await settle(0);

        expect(revealTarget.openUri).toHaveBeenCalledTimes(1);
        expect(revealTarget.editor.goToPosition).not.toHaveBeenCalled();
    });

    it("does nothing when a file node is activated", () => {
        const fileNode: ProblemNode = { kind: "file", resource: RESOURCE };
        component.tree.onActivate?.(fileNode);

        expect(revealTarget.openUri).not.toHaveBeenCalled();
    });

    it("focuses the Problems tree", async () => {
        markerService.changeOne("settings", RESOURCE, [warning("x")]);
        await settleMarkers();
        testApp.render();
        component.focus();
        expect(component.tree.isFocused).toBe(true);
    });

    it("reveal контейнера панели ведёт фокус в дерево (шов focus дескриптора)", async () => {
        markerService.changeOne("settings", RESOURCE, [warning("x")]);
        await settleMarkers();
        testApp.render();
        views.service.focusContainer(PROBLEMS_VIEW_ID);
        expect(component.tree.isFocused).toBe(true);
    });

    it("focus is a no-op when there are no problems (tree detached)", () => {
        // With no markers the tree is not attached to the panel; focus must not throw.
        expect(() => {
            component.focus();
        }).not.toThrow();
    });

    it("keeps file nodes expanded across successive marker updates", async () => {
        markerService.changeOne("settings", RESOURCE, [warning("a", 1)]);
        await settleMarkers();
        // A second update to the same (already-expanded) file must stay expanded.
        markerService.changeOne("settings", RESOURCE, [warning("a", 1), warning("b", 2)]);
        await settleMarkers();
        testApp.render();
        const screen = testApp.backend.screenToString();
        expect(screen).toContain("[Ln 2, Col 1]");
        expect(screen).toContain("[Ln 3, Col 1]");
    });
    describe("сведение изменений маркеров (монорепа: тысячи публикаций подряд)", () => {
        it("всплеск публикаций по многим файлам — один пересчёт дерева, и в нём все файлы", async () => {
            const refresh = vi.spyOn(component.tree, "refresh");
            for (let i = 0; i < 20; i++) {
                markerService.changeOne("java", `/ws/F${String(i)}.java`, [warning(`err ${String(i)}`)]);
            }
            expect(refresh).not.toHaveBeenCalled();

            await settleMarkers();
            expect(refresh).toHaveBeenCalledTimes(1);
            testApp.render();
            const screen = testApp.backend.screenToString();
            expect(screen).toContain("F0.java  (1)");
            expect(screen).toContain("err 0");
        });

        it("смена маркеров посреди пересчёта: второй не идёт параллельно, но и не теряется", async () => {
            let release: () => void = () => undefined;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            const original = component.tree.refresh.bind(component.tree);
            let running = 0;
            let maxRunning = 0;
            const refresh = vi.spyOn(component.tree, "refresh").mockImplementation(async (element) => {
                running++;
                maxRunning = Math.max(maxRunning, running);
                // Первый пересчёт держим, пока не придут новые маркеры.
                if (refresh.mock.calls.length === 1) await gate;
                await original(element);
                running--;
            });

            markerService.changeOne("java", "/ws/A.java", [warning("first")]);
            await settleMarkers();
            expect(refresh).toHaveBeenCalledTimes(1);

            markerService.changeOne("java", "/ws/B.java", [warning("second")]);
            await settleMarkers();
            // Первый ещё висит — второй не стартовал.
            expect(refresh).toHaveBeenCalledTimes(1);

            release();
            await settleMarkers();
            expect(refresh).toHaveBeenCalledTimes(2);
            expect(maxRunning).toBe(1);
            testApp.render();
            const screen = testApp.backend.screenToString();
            expect(screen).toContain("first");
            expect(screen).toContain("second");
        });

        it("таймер, сработавший после того, как пересчёт догнал версию, лишнего пересчёта не делает", async () => {
            let release: () => void = () => undefined;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            const original = component.tree.refresh.bind(component.tree);
            const refresh = vi.spyOn(component.tree, "refresh").mockImplementation(async (element) => {
                if (refresh.mock.calls.length === 1) await gate;
                await original(element);
            });

            markerService.changeOne("java", "/ws/A.java", [warning("first")]);
            await settleMarkers();
            // Новые маркеры посреди пересчёта; отпускаем его раньше, чем сработает их таймер.
            markerService.changeOne("java", "/ws/B.java", [warning("second")]);
            release();
            await settleMarkers();

            // Первый + догоняющий цикл; таймер второго события уже ничего не пересчитывает.
            expect(refresh).toHaveBeenCalledTimes(2);
        });

        it("файлы раскрываются одной пачкой, а не expand на каждый (иначе пересборка списка на файл)", async () => {
            const expandElements = vi.spyOn(component.tree, "expandElements");
            const expand = vi.spyOn(component.tree, "expand");
            for (let i = 0; i < 5; i++) {
                markerService.changeOne("java", `/ws/F${String(i)}.java`, [warning(`err ${String(i)}`)]);
            }

            await settleMarkers();

            expect(expand).not.toHaveBeenCalled();
            expect(expandElements).toHaveBeenCalledTimes(1);
            expect(expandElements.mock.calls[0][0]).toHaveLength(5);
            testApp.render();
            const screen = testApp.backend.screenToString();
            expect(screen).toContain("err 0");
            expect(screen).toContain("err 4");
        });

        it("после dispose отложенный пересчёт не выполняется", async () => {
            const refresh = vi.spyOn(component.tree, "refresh");
            markerService.changeOne("java", "/ws/A.java", [warning("x")]);
            component.dispose();
            await settleMarkers();
            expect(refresh).not.toHaveBeenCalled();
        });
    });
});
