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

        // The panel is already closed — `enablement: panelVisible` disables the command, and
        // a repeated call doesn't reopen it.
        h.commands.execute(CLOSE_PANEL);
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(false);
    });

    it("the control's close button is painted in the tab row and closes the panel", () => {
        h.commands.execute(TOGGLE_PANEL);
        h.testApp.render();

        const state = panel().inspectState();
        const close = state.close as { x: number; width: number };
        const row = h.testApp.backend.screenToString().split("\n")[state.tabRow as number];
        expect(row.slice(close.x, close.x + close.width)).toBe(" × ");

        panel().onClose?.();
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(false);
    });

    it("Toggle Problems shows the panel with Problems active, then hides it", () => {
        h.commands.execute(TOGGLE_PROBLEMS);
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(true);
        expect(panel().getActiveViewId()).toBe(PROBLEMS_VIEW_ID);

        h.testApp.render();
        const screen = h.testApp.backend.screenToString();
        expect(screen).toContain("PROBLEMS");
        expect(screen).toContain("No problems have been detected in the workspace.");

        h.commands.execute(TOGGLE_PROBLEMS);
        h.testApp.render();
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(false);
        expect(h.testApp.backend.screenToString()).not.toContain("PROBLEMS");
    });

    it("Toggle Problems re-opens the panel when it was toggled off", () => {
        h.commands.execute(TOGGLE_PANEL);
        h.commands.execute(TOGGLE_PANEL);
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(false);

        h.commands.execute(TOGGLE_PROBLEMS);
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(true);
        expect(panel().getActiveViewId()).toBe(PROBLEMS_VIEW_ID);
    });
});
