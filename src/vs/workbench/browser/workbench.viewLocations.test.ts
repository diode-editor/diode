import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { resolveUserDataPaths } from "../../platform/environment/node/userDataPaths.ts";
import { loadState, type StateService } from "../../platform/state/node/stateService.ts";
import { EXTENSIONS_VIEWLET_ID } from "../contrib/extensions/browser/extensionsComponent.ts";
import { PROBLEMS_VIEW_ID } from "../contrib/markers/browser/problemsComponent.ts";
import { SEARCH_VIEW_ID, SEARCH_VIEWLET_ID } from "../contrib/search/browser/searchComponent.ts";
import { NotificationServiceDIToken } from "../services/notification/browser/notificationService.ts";
import { OUTPUT_VIEW_ID } from "../services/output/common/output.ts";

import { AuxiliaryBarServiceDIToken } from "./parts/auxiliarybar/auxiliaryBarService.ts";
import { PanelServiceDIToken } from "./parts/panel/panelService.ts";
import { ViewsServiceDIToken } from "./parts/views/viewsService.ts";
import { WorkbenchContextKeysDIToken } from "./workbenchContextKeys.ts";

const SIZE = new Size(120, 24);

/** Microtasks and zero timers: picking from the list resolves asynchronously. */
const settle = (): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, 0);
    });

function typeText(h: IAppHarness, text: string): void {
    for (const char of text) h.testApp.sendKey(char === " " ? "Space" : char);
}

function panelTabs(h: IAppHarness): string[] {
    return h.container
        .get(PanelServiceDIToken)
        .getViews()
        .map((view) => view.title);
}

function auxiliaryTabs(h: IAppHarness): string[] {
    return h.container
        .get(AuxiliaryBarServiceDIToken)
        .getViews()
        .map((view) => view.title);
}

function frame(h: IAppHarness): string[] {
    h.testApp.render();
    return h.testApp.backend.screenToString().split("\n");
}

function focusView(h: IAppHarness, viewId: string): void {
    h.container.get(ViewsServiceDIToken).openView(viewId, true);
    h.container.get(WorkbenchContextKeysDIToken).update();
}

describe("Workbench: moving views with commands", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-viewloc-", files: { "a.txt": "hello" } });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: ws.path("a.txt"),
            focusEditor: true,
            size: SIZE,
        });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("Move Focused View → New Secondary Side Bar Entry: SEARCH on the right, gone from the sidebar, focused", async () => {
        focusView(h, SEARCH_VIEW_ID);
        expect(h.container.get(ContextKeyServiceDIToken).get("focusedView")).toBe(SEARCH_VIEW_ID);

        void h.commands.execute("workbench.action.moveFocusedView");
        expect(frame(h).join("\n")).toContain("View: Move SEARCH");
        typeText(h, "New Secondary");
        h.testApp.sendKey("Enter");
        await settle();

        expect(auxiliaryTabs(h)).toEqual(["SEARCH"]);
        expect(h.container.get(ViewsServiceDIToken).getViewContainerByViewId(SEARCH_VIEW_ID)).not.toBe(
            SEARCH_VIEWLET_ID,
        );
        expect(h.container.get(AuxiliaryBarServiceDIToken).visible).toBe(true);
        h.container.get(WorkbenchContextKeysDIToken).update();
        expect(h.container.get(ContextKeyServiceDIToken).get("auxiliaryBarFocus")).toBe(true);
        expect(h.container.get(ContextKeyServiceDIToken).get("focusedView")).toBe(SEARCH_VIEW_ID);
        const part = h.workbench.workbenchLayout.getRightPanel()!;
        expect(frame(h)[1].slice(part.globalPosition.x)).toContain("SEARCH");
    });

    it("without a focused view Move Focused View is disabled", () => {
        h.container.get(WorkbenchContextKeysDIToken).update();
        void h.commands.execute("workbench.action.moveFocusedView");
        expect(frame(h).join("\n")).not.toContain("Select a Destination for the View");
    });

    it("a non-movable view shows an error message, no location choice", async () => {
        h.container.get(ViewsServiceDIToken).openViewContainer(EXTENSIONS_VIEWLET_ID, true);
        h.container.get(WorkbenchContextKeysDIToken).update();
        expect(h.container.get(ContextKeyServiceDIToken).get("focusedView")).not.toBe("");

        await h.commands.execute("workbench.action.moveFocusedView");
        const notification = h.container.get(NotificationServiceDIToken).current();
        expect(notification?.message).toBe("The currently focused view is not movable.");
        expect(frame(h).join("\n")).not.toContain("Select a Destination for the View");
    });

    it("Move View: first the view, then the location", async () => {
        void h.commands.execute("workbench.action.moveView");
        const screen = frame(h).join("\n");
        expect(screen).toContain("Select a View to Move");
        // The group label sits on the right of the item (upstream shows it as a separator label).
        expect(screen).toContain("Panel / PROBLEMS");
        typeText(h, "PROBLEMS");
        h.testApp.sendKey("Enter");
        await settle();
        expect(frame(h).join("\n")).toContain("View: Move PROBLEMS");
        typeText(h, "New Secondary");
        h.testApp.sendKey("Enter");
        await settle();
        expect(auxiliaryTabs(h)).toEqual(["PROBLEMS"]);
        expect(h.container.get(ViewsServiceDIToken).getViewContainerByViewId(PROBLEMS_VIEW_ID)).toMatch(
            /^workbench\.views\.service\.auxiliarybar\./,
        );
    });

    it("Move Panel Views To Secondary Side Bar and back", () => {
        // Make a non-first tab active in the panel, so it's visible that exactly that one opens.
        h.container.get(PanelServiceDIToken).setActiveView(OUTPUT_VIEW_ID);
        void h.commands.execute("workbench.action.movePanelToSecondarySideBar");
        expect(panelTabs(h)).toEqual([]);
        expect(auxiliaryTabs(h)).toEqual(["PROBLEMS", "OUTPUT", "TERMINAL"]);
        expect(h.container.get(AuxiliaryBarServiceDIToken).visible).toBe(true);
        expect(h.container.get(AuxiliaryBarServiceDIToken).getActiveViewId()).toBe(OUTPUT_VIEW_ID);

        void h.commands.execute("workbench.action.moveSecondarySideBarToPanel");
        expect(auxiliaryTabs(h)).toEqual([]);
        expect(panelTabs(h)).toEqual(["PROBLEMS", "OUTPUT", "TERMINAL"]);
        expect(h.container.get(PanelServiceDIToken).visible).toBe(true);
    });

    it("Move Panel… leaves an empty source part alone", () => {
        void h.commands.execute("workbench.action.moveSecondarySideBarToPanel");
        expect(h.container.get(PanelServiceDIToken).visible).toBe(false);
    });

    it("Reset View Locations puts everything back", () => {
        void h.commands.execute("workbench.action.movePanelToSecondarySideBar");
        void h.commands.execute("workbench.action.resetViewLocations");
        expect(auxiliaryTabs(h)).toEqual([]);
        expect(panelTabs(h)).toEqual(["PROBLEMS", "OUTPUT", "TERMINAL"]);
    });

    it("Reset Focused View Location returns the focused view home", () => {
        const views = h.container.get(ViewsServiceDIToken);
        views.moveViewToLocation(SEARCH_VIEW_ID, "auxiliarybar");
        focusView(h, SEARCH_VIEW_ID);
        void h.commands.execute("workbench.action.resetFocusedViewLocation");
        expect(views.getViewContainerByViewId(SEARCH_VIEW_ID)).toBe(views.getDefaultContainerById(SEARCH_VIEW_ID));
        expect(auxiliaryTabs(h)).toEqual([]);
        expect(h.workbench.workbenchLayout.getLeftPanelVisible()).toBe(true);
    });

    it("an empty secondary side bar hints how to get views into it", () => {
        void h.commands.execute("workbench.action.toggleAuxiliaryBar");
        const part = h.workbench.workbenchLayout.getRightPanel()!;
        const text = frame(h)
            .slice(1, 5)
            .map((row) => row.slice(part.globalPosition.x))
            .join(" ");
        expect(text.replace(/\s+/g, " ")).toContain("Use 'View: Move View' to display a view here.");
    });
});

describe("Workbench: moved views survive a restart", () => {
    let ws: ITempWorkspace;
    let userData: ITempWorkspace;
    let writers: StateService[];

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-viewloc-persist-ws-" });
        userData = createTempWorkspace({ prefix: "diode-viewloc-persist-home-" });
        writers = [];
    });

    afterEach(() => {
        for (const writer of writers) writer.dispose();
        ws.dispose();
        userData.dispose();
    });

    function launch(): { h: IAppHarness; state: StateService } {
        const state = loadState(resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir }));
        writers.push(state);
        return { h: createAppTestHarness({ workspaceFolder: ws.dir, stateService: state, size: SIZE }), state };
    }

    it("OUTPUT stays in the secondary side bar and the side bar is visible after a restart", () => {
        const first = launch();
        first.h.container.get(ViewsServiceDIToken).moveViewToLocation(OUTPUT_VIEW_ID, "auxiliarybar");
        first.h.container.get(ViewsServiceDIToken).openView(OUTPUT_VIEW_ID, true);
        first.state.flushSync();
        first.h.dispose();

        const second = launch();
        expect(auxiliaryTabs(second.h)).toEqual(["OUTPUT"]);
        expect(panelTabs(second.h)).not.toContain("OUTPUT");
        expect(second.h.workbench.workbenchLayout.getRightPanelVisible()).toBe(true);
        second.h.dispose();
    });
});
