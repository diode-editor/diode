import { beforeEach, describe, expect, it, vi } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { IMarkerData } from "../../../../platform/markers/common/iMarker.ts";
import { MarkerSeverity } from "../../../../platform/markers/common/iMarker.ts";
import { MarkerService } from "../../../../platform/markers/common/markerService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { PanelComponent } from "../../../browser/parts/panel/panelComponent.ts";
import { PanelService } from "../../../browser/parts/panel/panelService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { type IMarkerRevealEditor, PROBLEMS_VIEW_ID, ProblemsComponent } from "./problemsComponent.ts";
import { NULL_JUMP_RECORDER } from "../../../services/history/browser/historyService.ts";
import type { ProblemNode } from "./problemsTreeDataProvider.ts";
import type { IViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";

const RESOURCE = "/ws/settings.json";

function warning(message: string, line = 0): IMarkerData {
    return { severity: MarkerSeverity.Warning, range: createRange(line, 0, line, 3), message };
}

/** Reveal-цель-фейк: записывает открытия/переходы (структурная замена EditorService). */
function makeRevealTarget() {
    const editor = {
        goToPosition: vi.fn(),
        revealRange: vi.fn(),
    };
    return {
        editor,
        openUri: vi.fn<(uri: Uri) => void>(),
        getActiveEditor: (): IMarkerRevealEditor | null => editor,
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
        panelComponent = new PanelComponent(panelService);
        revealTarget = makeRevealTarget();
        component = new ProblemsComponent(markerService, views.service, revealTarget, NULL_JUMP_RECORDER);
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
        // Тело подменяется синхронно на смене маркеров.
        expect(views.paneView(PROBLEMS_VIEW_ID).querySelector("#problemsView")).toBe(component.view);

        await settle(0);
        testApp.render();
        const screen = testApp.backend.screenToString();
        expect(screen).toContain("settings.json");
        expect(screen).toContain("Unknown Setting: x");
        expect(screen).toContain("[Ln 2, Col 1]");
    });

    it("falls back to the placeholder when the markers clear", () => {
        markerService.changeOne("settings", RESOURCE, [warning("x")]);
        expect(views.paneView(PROBLEMS_VIEW_ID).querySelector("#problemsView")).toBe(component.view);

        markerService.changeOne("settings", RESOURCE, []);
        expect(views.paneView(PROBLEMS_VIEW_ID).querySelector("#problemsView")).toBeNull();
    });

    it("reveals a marker's location through the reveal seam on activation", () => {
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

        expect(revealTarget.openUri).toHaveBeenCalledTimes(1);
        // Ресурс поднимается парсингом (не Uri.file) — см. комментарий в revealMarker.
        expect(revealTarget.openUri.mock.calls[0][0].toString()).toBe(Uri.parse(RESOURCE).toString());
        expect(revealTarget.editor.goToPosition).toHaveBeenCalledWith(2, 2);
        expect(revealTarget.editor.revealRange).toHaveBeenCalledWith(createRange(2, 2, 2, 7));
    });

    it("does nothing when a file node is activated", () => {
        const fileNode: ProblemNode = { kind: "file", resource: RESOURCE };
        component.tree.onActivate?.(fileNode);

        expect(revealTarget.openUri).not.toHaveBeenCalled();
    });

    it("focuses the Problems tree", async () => {
        markerService.changeOne("settings", RESOURCE, [warning("x")]);
        await settle(0);
        testApp.render();
        component.focus();
        expect(component.tree.isFocused).toBe(true);
    });

    it("reveal контейнера панели ведёт фокус в дерево (шов focus дескриптора)", async () => {
        markerService.changeOne("settings", RESOURCE, [warning("x")]);
        await settle(0);
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
        await settle(0);
        // A second update to the same (already-expanded) file must stay expanded.
        markerService.changeOne("settings", RESOURCE, [warning("a", 1), warning("b", 2)]);
        await settle(0);
        testApp.render();
        const screen = testApp.backend.screenToString();
        expect(screen).toContain("[Ln 2, Col 1]");
        expect(screen).toContain("[Ln 3, Col 1]");
    });
});
