import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkbenchLayoutElement } from "@tuidom/all/ui/workbenchlayout/workbenchLayoutElement";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { resolveUserDataPaths } from "../../../../platform/environment/node/userDataPaths.ts";
import { loadState, StateService } from "../../../../platform/state/node/stateService.ts";
import { PanelService } from "../../../browser/parts/panel/panelService.ts";
import {
    PANEL_ACTIVE_VIEW_STATE,
    PANEL_HEIGHT_STATE,
    PANEL_VISIBLE_STATE,
    SIDEBAR_VISIBLE_STATE,
    SIDEBAR_WIDTH_STATE,
} from "../../../common/stateKeys.ts";

import { LayoutService } from "./layoutService.ts";

describe("LayoutService", () => {
    let ws: ITempWorkspace;
    let state: StateService;
    let panelService: PanelService;
    let contextKeys: ContextKeyService;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "vexx-layoutsvc-" });
        state = loadState(resolveUserDataPaths({ homedir: "/never", userDataDir: ws.dir }));
        panelService = new PanelService();
        contextKeys = new ContextKeyService();
    });

    afterEach(() => {
        ws.dispose();
    });

    function make(layout?: WorkbenchLayoutElement): { service: LayoutService; layout: WorkbenchLayoutElement } {
        const element = layout ?? new WorkbenchLayoutElement();
        const service = new LayoutService(state, panelService, contextKeys);
        service.attachLayout(element);
        return { service, layout: element };
    }

    describe("персист layout'а", () => {
        it("restores saved layout onto the element", () => {
            state.store(SIDEBAR_WIDTH_STATE, 44);
            state.store(SIDEBAR_VISIBLE_STATE, false);
            state.store(PANEL_HEIGHT_STATE, 7);
            state.store(PANEL_VISIBLE_STATE, true);

            const { service, layout } = make();
            service.restoreLayout();

            expect(layout.getLeftPanelWidth()).toBe(44);
            expect(layout.getLeftPanelVisible()).toBe(false);
            expect(layout.getBottomPanelHeight()).toBe(7);
            expect(layout.getBottomPanelVisible()).toBe(true);
        });

        it("applies descriptor defaults when nothing is stored", () => {
            const element = new WorkbenchLayoutElement();
            element.setLeftPanelWidth(99); // diverge, then restore should reset to default 30
            const { service, layout } = make(element);
            service.restoreLayout();
            expect(layout.getLeftPanelWidth()).toBe(30);
            expect(layout.getBottomPanelVisible()).toBe(false);
        });

        it("restore syncs the panel-visibility truth into PanelService", () => {
            state.store(PANEL_VISIBLE_STATE, true);
            const { service } = make();
            service.restoreLayout();
            // Иначе первый toggle после рестора отработал бы вхолостую.
            expect(panelService.visible).toBe(true);
        });

        it("captures the element's current layout into the store", () => {
            const element = new WorkbenchLayoutElement();
            element.setLeftPanelWidth(50);
            element.setLeftPanelVisible(false);
            element.setBottomPanelHeight(9);
            element.setBottomPanelVisible(true);

            const { service } = make(element);
            service.captureLayout();

            expect(state.get(SIDEBAR_WIDTH_STATE)).toBe(50);
            expect(state.get(SIDEBAR_VISIBLE_STATE)).toBe(false);
            expect(state.get(PANEL_HEIGHT_STATE)).toBe(9);
            expect(state.get(PANEL_VISIBLE_STATE)).toBe(true);
        });

        it("suppresses auto-capture while restoring, but captures afterwards", () => {
            state.store(SIDEBAR_WIDTH_STATE, 40);
            // attachLayout вешает write-through на onDidChangeLayout — restore не эхо-пишет.
            const { service, layout } = make();

            service.restoreLayout();
            expect(layout.getLeftPanelWidth()).toBe(40);

            // A genuine post-restore change still writes through.
            layout.setLeftPanelWidth(55);
            expect(state.get(SIDEBAR_WIDTH_STATE)).toBe(55);
        });

        it("round-trips layout capture → restore", () => {
            const src = new WorkbenchLayoutElement();
            src.setLeftPanelWidth(37);
            src.setBottomPanelVisible(true);
            make(src).service.captureLayout();

            const { service, layout } = make();
            service.restoreLayout();
            expect(layout.getLeftPanelWidth()).toBe(37);
            expect(layout.getBottomPanelVisible()).toBe(true);
        });
    });

    describe("сайдбар", () => {
        it("toggleSidebar flips the sidebar visibility (and persists it)", () => {
            const { service, layout } = make();
            expect(service.isSidebarVisible()).toBe(true);

            service.toggleSidebar();
            expect(layout.getLeftPanelVisible()).toBe(false);
            expect(state.get(SIDEBAR_VISIBLE_STATE)).toBe(false);

            service.toggleSidebar();
            expect(layout.getLeftPanelVisible()).toBe(true);
        });

        it("setSidebarVisible(true) shows the sidebar", () => {
            const { service, layout } = make();
            service.setSidebarVisible(false);
            service.setSidebarVisible(true);
            expect(layout.getLeftPanelVisible()).toBe(true);
        });

        it("nudge and reset change the sidebar width via the element", () => {
            const { service, layout } = make();
            const before = layout.getLeftPanelWidth();
            service.nudgeSidebarWidth(3);
            // Вне layout-прохода элемент клампит к своему (нулевому) размеру контейнера —
            // важно лишь, что вызов дошёл до элемента и записался в стор.
            expect(state.get(SIDEBAR_WIDTH_STATE)).toBe(layout.getLeftPanelWidth());
            service.resetSidebarWidth();
            expect(layout.getLeftPanelWidth()).toBe(before);
            expect(state.get(SIDEBAR_WIDTH_STATE)).toBe(before);
        });
    });

    describe("нижняя панель", () => {
        it("setPanelVisible routes through PanelService and the layout follows", () => {
            const { service, layout } = make();
            service.setPanelVisible(true);

            expect(panelService.visible).toBe(true);
            expect(layout.getBottomPanelVisible()).toBe(true);
            expect(contextKeys.get("panelVisible")).toBe(true);
            expect(service.isPanelVisible()).toBe(true);

            service.setPanelVisible(false);
            expect(layout.getBottomPanelVisible()).toBe(false);
            expect(contextKeys.get("panelVisible")).toBe(false);
        });

        it("persists the active panel tab and restores it after a restart", () => {
            panelService.addView({ id: "problems", title: "PROBLEMS" });
            panelService.addView({ id: "terminal", title: "TERMINAL" });

            const { service } = make();
            service.restoreLayout();
            panelService.activateView("terminal");
            expect(state.get(PANEL_ACTIVE_VIEW_STATE)).toBe("terminal");

            // «Перезапуск»: свежий PanelService с тем же порядком регистрации.
            panelService = new PanelService();
            panelService.addView({ id: "problems", title: "PROBLEMS" });
            panelService.addView({ id: "terminal", title: "TERMINAL" });
            expect(panelService.getActiveViewId()).toBe("problems");

            make().service.restoreLayout();
            expect(panelService.getActiveViewId()).toBe("terminal");
        });

        it("restore activates the tab without waking lazy features", () => {
            panelService.addView({ id: "problems", title: "PROBLEMS" });
            panelService.addView({ id: "terminal", title: "TERMINAL" });
            state.store(PANEL_ACTIVE_VIEW_STATE, "terminal");

            let activated = 0;
            panelService.onDidActivateView(() => {
                activated++;
            });

            make().service.restoreLayout();
            // Ленивый спавн шелла висит на onDidActivateView — restore его не будит.
            expect(panelService.getActiveViewId()).toBe("terminal");
            expect(activated).toBe(0);
        });

        it("keeps the first registered tab active when nothing is stored", () => {
            panelService.addView({ id: "problems", title: "PROBLEMS" });
            panelService.addView({ id: "terminal", title: "TERMINAL" });

            make().service.restoreLayout();
            expect(panelService.getActiveViewId()).toBe("problems");
        });

        it("captureLayout snapshots the active tab too", () => {
            panelService.addView({ id: "problems", title: "PROBLEMS" });
            panelService.addView({ id: "terminal", title: "TERMINAL" });
            panelService.setActiveView("terminal");

            make().service.captureLayout();
            expect(state.get(PANEL_ACTIVE_VIEW_STATE)).toBe("terminal");
        });

        it("captureLayout stores an empty id when no tab is registered", () => {
            make().service.captureLayout();
            expect(state.get(PANEL_ACTIVE_VIEW_STATE)).toBe("");
        });

        it("visibility changes before attachLayout still update the context key", () => {
            const service = new LayoutService(state, panelService, contextKeys);
            expect(() => {
                service.setPanelVisible(true);
            }).not.toThrow();
            expect(contextKeys.get("panelVisible")).toBe(true);
        });
    });

    it("throws when used before attachLayout", () => {
        const service = new LayoutService(state, panelService, contextKeys);
        expect(() => {
            service.toggleSidebar();
        }).toThrow("attachLayout");
    });
});
