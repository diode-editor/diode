import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { ContextKeyService, ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { PROBLEMS_VIEW_ID } from "../contrib/markers/browser/problemsComponent.ts";

import type { PanelContainerElement } from "./parts/panel/panelContainerElement.ts";

const TOGGLE_PANEL = "workbench.action.togglePanel";
const TOGGLE_PROBLEMS = "workbench.actions.view.problems";
const CLOSE_PANEL = "workbench.action.closePanel";

describe("Workbench — bottom panel visibility commands", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let contextKeys: ContextKeyService;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-panel-" });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        contextKeys = h.container.get(ContextKeyServiceDIToken);
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function panel(): PanelContainerElement {
        return h.workbench.workbenchLayout.getBottomPanel() as PanelContainerElement;
    }

    it("mounts the Panel component's view as the workbench bottom panel, hidden initially", () => {
        expect(panel().getViewIds()).toContain(PROBLEMS_VIEW_ID);
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(false);
    });

    it("toggles panel visibility and keeps the context key in sync", () => {
        h.commands.execute(TOGGLE_PANEL);
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(true);
        expect(contextKeys.get("panelVisible")).toBe(true);

        h.commands.execute(TOGGLE_PANEL);
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(false);
        expect(contextKeys.get("panelVisible")).toBe(false);
    });

    it("Close Panel hides the panel and syncs the context key", () => {
        h.commands.execute(TOGGLE_PANEL);
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(true);

        h.commands.execute(CLOSE_PANEL);
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(false);
        expect(contextKeys.get("panelVisible")).toBe(false);

        // Панель уже закрыта — `enablement: panelVisible` гасит команду, и
        // повторный вызов её не «открывает обратно».
        h.commands.execute(CLOSE_PANEL);
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(false);
    });

    it("the control's close button is painted in the tab row and closes the panel", () => {
        h.commands.execute(TOGGLE_PANEL);
        h.testApp.render();

        // Кнопка нарисована в правом конце строки вкладок — там, где её ищет
        // пользователь, и там, куда смотрит `inspectState`.
        const state = panel().inspectState();
        const close = state.close as { x: number; width: number };
        const row = h.testApp.backend.screenToString().split("\n")[state.tabRow as number];
        expect(row.slice(close.x, close.x + close.width)).toBe(" × ");

        // Весь провод от виджета: колбэк контрола → компонент → команда → layout.
        panel().onClose?.();
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(false);
    });

    it("Toggle Problems shows the panel with Problems active, then hides it", () => {
        h.commands.execute(TOGGLE_PROBLEMS);
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(true);
        expect(panel().getActiveViewId()).toBe(PROBLEMS_VIEW_ID);

        // End-to-end: the panel actually paints its tab + empty-state on screen.
        h.testApp.render();
        const screen = h.testApp.backend.screenToString();
        expect(screen).toContain("PROBLEMS");
        expect(screen).toContain("No problems have been detected in the workspace.");

        // Problems already visible+active → the command hides the panel.
        h.commands.execute(TOGGLE_PROBLEMS);
        h.testApp.render();
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(false);
        expect(h.testApp.backend.screenToString()).not.toContain("PROBLEMS");
    });

    it("Toggle Problems re-opens the panel when it was toggled off", () => {
        h.commands.execute(TOGGLE_PANEL); // open (Problems active by default)
        h.commands.execute(TOGGLE_PANEL); // close
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(false);

        // Panel hidden → Toggle Problems opens it again rather than staying hidden.
        h.commands.execute(TOGGLE_PROBLEMS);
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(true);
        expect(panel().getActiveViewId()).toBe(PROBLEMS_VIEW_ID);
    });
});
