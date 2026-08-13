import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PanelContainerElement } from "@tuidom/all/ui/panel/panelContainerElement";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { ContextKeyService, ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { PROBLEMS_VIEW_ID } from "../contrib/markers/browser/problemsComponent.ts";

const TOGGLE_PANEL = "workbench.action.togglePanel";
const TOGGLE_PROBLEMS = "workbench.actions.view.problems";

describe("Workbench — bottom panel visibility commands", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let contextKeys: ContextKeyService;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "vexx-panel-" });
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
