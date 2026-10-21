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

const settleMarkers = (): Promise<void> => settle(PROBLEMS_UPDATE_DELAY_MS + 10);

function warning(message: string, line = 0): IMarkerData {
    return { severity: MarkerSeverity.Warning, range: createRange(line, 0, line, 3), message };
}

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
        // The PROBLEMS container is built by the workbench's mount() — here it plays that role.
        views.service.attachRegisteredContainers();
        testApp = TestApp.createWithContent(panelComponent.view, new Size(70, 12));
    });

    it("registers the PROBLEMS view and makes it the active tab", () => {
        expect(panelComponent.view.getViewIds()).toContain("workbench.panel.markers.view");
        expect(panelService.getActiveViewId()).toBe("workbench.panel.markers.view");
    });

    it("shows the placeholder (no view body) until markers appear, then the tree", async () => {
        // No markers → the view has no body → the section renders its own empty state.
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
        // Opening a resource is a promise (a non-disk one goes to the scheme provider),
        // so the cursor jump lands on the next tick.
        await settle(0);

        expect(revealTarget.openUri).toHaveBeenCalledTimes(1);
        // The resource is obtained by parsing, not Uri.file.
        expect(revealTarget.openUri.mock.calls[0][0].toString()).toBe(Uri.parse(RESOURCE).toString());
        expect(revealTarget.editor.goToPosition).toHaveBeenCalledWith(2, 2);
        expect(revealTarget.editor.revealRange).toHaveBeenCalledWith(createRange(2, 2, 2, 7));
    });

    it("resource failed to open — the cursor in ANOTHER editor is not moved", async () => {
        // A non-disk marker (`jdt:`) without a scheme provider: `openUri` does not create
        // a tab, the previous editor stays active. Moving its cursor to the
        // coordinates of someone else's marker is wrong.
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

    it("no editors at all — navigating to a marker does not throw", async () => {
        // A non-disk marker (`jdt:`) without a scheme provider with an empty tab
        // strip: `openUri` opened nothing, there is no active editor.
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

    it("revealing the panel container moves focus into the tree (descriptor focus seam)", async () => {
        markerService.changeOne("settings", RESOURCE, [warning("x")]);
        await settleMarkers();
        testApp.render();
        views.service.focusContainer(PROBLEMS_VIEW_ID);
        expect(component.tree.isFocused).toBe(true);
    });

    it("focus is a no-op when there are no problems (tree detached)", () => {
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
    describe("coalescing marker changes (monorepo: thousands of publications in a row)", () => {
        it("burst of publications across many files — one tree refresh containing all files", async () => {
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

        it("markers change mid-refresh: the second refresh does not run in parallel but is not lost", async () => {
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
                // Hold the first recompute until new markers arrive.
                if (refresh.mock.calls.length === 1) await gate;
                await original(element);
                running--;
            });

            markerService.changeOne("java", "/ws/A.java", [warning("first")]);
            await settleMarkers();
            expect(refresh).toHaveBeenCalledTimes(1);

            markerService.changeOne("java", "/ws/B.java", [warning("second")]);
            await settleMarkers();
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

        it("a timer firing after the refresh caught up with the version does no extra refresh", async () => {
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
            // New markers in the middle of a recompute; release it before their timer fires.
            markerService.changeOne("java", "/ws/B.java", [warning("second")]);
            release();
            await settleMarkers();

            // The first plus a catch-up cycle; the second event's timer no longer recomputes anything.
            expect(refresh).toHaveBeenCalledTimes(2);
        });

        it("files are expanded in one batch, not one expand each (otherwise the list is rebuilt per file)", async () => {
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

        it("a pending refresh does not run after dispose", async () => {
            const refresh = vi.spyOn(component.tree, "refresh");
            markerService.changeOne("java", "/ws/A.java", [warning("x")]);
            component.dispose();
            await settleMarkers();
            expect(refresh).not.toHaveBeenCalled();
        });
    });
});
