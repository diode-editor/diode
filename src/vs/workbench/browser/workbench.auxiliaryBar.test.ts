import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { resolveUserDataPaths } from "../../platform/environment/node/userDataPaths.ts";
import { loadState, type StateService } from "../../platform/state/node/stateService.ts";
import { LayoutServiceDIToken } from "../services/layout/browser/layoutService.ts";

import { AuxiliaryBarServiceDIToken } from "./parts/auxiliarybar/auxiliaryBarService.ts";
import type { PanelContainerElement } from "./parts/panel/panelContainerElement.ts";
import { ViewsServiceDIToken } from "./parts/views/viewsService.ts";
import { WorkbenchContextKeysDIToken } from "./workbenchContextKeys.ts";

const TOGGLE = "workbench.action.toggleAuxiliaryBar";
const CLOSE = "workbench.action.closeAuxiliaryBar";
const FOCUS = "workbench.action.focusAuxiliaryBar";
const NEXT = "workbench.action.nextAuxiliaryBarView";
const PREVIOUS = "workbench.action.previousAuxiliaryBarView";
const INCREASE = "workbench.action.increaseViewSize";
const DECREASE = "workbench.action.decreaseViewSize";

const SIZE = new Size(100, 20);

class FocusableBody extends TUIElement {
    public constructor(id: string) {
        super();
        this.id = id;
        this.focusable = true;
    }
}

describe("Workbench — secondary side bar", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-auxbar-", files: { "a.txt": "hello" } });
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

    function part(): PanelContainerElement {
        return h.workbench.workbenchLayout.getRightPanel() as PanelContainerElement;
    }

    function frame(): string[] {
        h.testApp.render();
        return h.testApp.backend.screenToString().split("\n");
    }

    function visible(): boolean {
        return h.workbench.workbenchLayout.getRightPanelVisible();
    }

    function contextKey(key: "auxiliaryBarVisible" | "auxiliaryBarFocus" | "activeAuxiliary"): unknown {
        h.container.get(WorkbenchContextKeysDIToken).update();
        return h.container.get(ContextKeyServiceDIToken).get(key);
    }

    function addContainer(id: string, title: string, order: number): FocusableBody {
        const views = h.container.get(ViewsServiceDIToken);
        const body = new FocusableBody(`${id}-body`);
        views.registerContainer({ id, title, location: "auxiliarybar", order });
        views.registerView({
            id: `${id}.view`,
            containerId: id,
            title,
            order: 10,
            body,
            focus: () => {
                body.focus();
            },
        });
        views.attachContainer(id);
        return body;
    }

    function focused(): TUIElement | null {
        return h.workbench.view.focusManager?.activeElement ?? null;
    }

    it("the part is the right layout column with id auxiliarybar, hidden at startup", () => {
        expect(part().id).toBe("auxiliarybar");
        expect(visible()).toBe(false);
        expect(contextKey("auxiliaryBarVisible")).toBe(false);
        expect(frame()[1].endsWith(" × ")).toBe(false);
    });

    it("Ctrl+Alt+B shows the empty part on the right with a close button and hides it again", () => {
        h.testApp.sendKey("Ctrl+Alt+B");
        expect(visible()).toBe(true);
        expect(contextKey("auxiliaryBarVisible")).toBe(true);
        // Row 1 is the part's first row (below the menu bar): the `×` button is at its right end.
        expect(frame()[1].endsWith(" × ")).toBe(true);
        const close = part().inspectState().close as { x: number };
        // 100 columns: the default width is a quarter of the window, 25.
        expect(close.x).toBe(SIZE.width - 3);
        expect(part().globalPosition.x).toBe(SIZE.width - 25);

        h.testApp.sendKey("Ctrl+Alt+B");
        expect(visible()).toBe(false);
        expect(frame()[1].endsWith(" × ")).toBe(false);
    });

    it("the × button closes the part via the command; Hide is disabled on a hidden part", () => {
        h.commands.execute(TOGGLE);
        part().onClose?.();
        expect(visible()).toBe(false);
        expect(contextKey("auxiliaryBarVisible")).toBe(false);
        h.commands.execute(CLOSE);
        expect(visible()).toBe(false);
    });

    it("showing focuses the active container, hiding returns focus to the editor", () => {
        const body = addContainer("test.aux.one", "ONE", 1);
        expect(frame()[1]).not.toContain("ONE");

        h.commands.execute(TOGGLE);
        expect(focused() === body).toBe(true);
        expect(contextKey("auxiliaryBarFocus")).toBe(true);
        expect(contextKey("activeAuxiliary")).toBe("test.aux.one");
        const row = frame()[1];
        expect(row.slice(part().globalPosition.x)).toContain("ONE");

        h.commands.execute(TOGGLE);
        // A boolean rather than toBe on elements: vitest serializes a diff of two tree nodes in full.
        expect(focused()?.getAncestorPath().includes(h.activeEditor().view) ?? false).toBe(true);
        expect(contextKey("auxiliaryBarFocus")).toBe(false);
        expect(contextKey("activeAuxiliary")).toBe("");
    });

    it("Focus into Secondary Side Bar shows the hidden part and focuses it", () => {
        const body = addContainer("test.aux.one", "ONE", 1);
        h.commands.execute(FOCUS);
        expect(visible()).toBe(true);
        expect(focused() === body).toBe(true);
    });

    it("Next/Previous Secondary Side Bar View cycle through the tabs", () => {
        // Three tabs: with two, a step forward and a step back are indistinguishable.
        addContainer("test.aux.one", "ONE", 1);
        const two = addContainer("test.aux.two", "TWO", 2);
        addContainer("test.aux.three", "THREE", 3);
        const auxiliaryBar = h.container.get(AuxiliaryBarServiceDIToken);
        expect(auxiliaryBar.getActiveViewId()).toBe("test.aux.one");

        h.commands.execute(NEXT);
        expect(auxiliaryBar.getActiveViewId()).toBe("test.aux.two");
        expect(visible()).toBe(true);
        expect(focused() === two).toBe(true);

        h.commands.execute(PREVIOUS);
        expect(auxiliaryBar.getActiveViewId()).toBe("test.aux.one");
        h.commands.execute(PREVIOUS);
        expect(auxiliaryBar.getActiveViewId()).toBe("test.aux.three");
        h.commands.execute(NEXT);
        expect(auxiliaryBar.getActiveViewId()).toBe("test.aux.one");
    });

    it("Next/Previous do nothing on an empty part", () => {
        h.commands.execute(NEXT);
        expect(visible()).toBe(false);
    });

    it("Increase Current View Size with focus in the part widens it on the frame", () => {
        addContainer("test.aux.one", "ONE", 1);
        h.commands.execute(TOGGLE);
        h.commands.execute(INCREASE);
        frame();
        expect(part().layoutSize.width).toBe(28);
        expect(part().globalPosition.x).toBe(SIZE.width - 28);
    });

    it("Decrease Current View Size with focus in the editor gives its columns to the part and its rows to the panel", () => {
        addContainer("test.aux.one", "ONE", 1);
        const layout = h.container.get(LayoutServiceDIToken);
        layout.setAuxiliaryBarVisible(true);
        layout.setPanelVisible(true);
        frame();
        expect(layout.getFocusedPart()).toBe("editor");
        const bottom = h.workbench.workbenchLayout.getBottomPanel()!;
        const height = bottom.layoutSize.height;
        h.commands.execute(DECREASE);
        frame();
        expect(part().layoutSize.width).toBe(28);
        expect(bottom.layoutSize.height).toBe(height + 1);
    });

    it("narrow terminal (80): the editor keeps 20 columns, the part shrinks first", () => {
        h.dispose();
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 20) });
        const layout = h.container.get(LayoutServiceDIToken);
        layout.setAuxiliaryBarVisible(true);
        h.workbench.workbenchLayout.setRightPanelWidth(60);
        frame();
        const left = h.workbench.workbenchLayout.getLeftPanel()!.layoutSize.width;
        expect(part().layoutSize.width).toBe(80 - 20 - left);
        expect(h.workbench.workbenchLayout.getCenterContent()!.layoutSize.width).toBe(20);
    });
});

describe("Workbench — secondary side bar survives a restart", () => {
    let ws: ITempWorkspace;
    let userData: ITempWorkspace;
    let writers: StateService[];

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-auxbar-persist-ws-" });
        userData = createTempWorkspace({ prefix: "diode-auxbar-persist-home-" });
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

    it("width persists; an empty part left visible is not shown at startup", () => {
        const first = launch();
        const layout = first.h.container.get(LayoutServiceDIToken);
        layout.setAuxiliaryBarVisible(true);
        first.h.testApp.render();
        layout.nudgeAuxiliaryBarWidth(5);
        first.state.flushSync();
        first.h.dispose();

        const second = launch();
        const restored = second.h.workbench.workbenchLayout;
        expect(restored.getRightPanelWidth()).toBe(30);
        // The secondary panel has no containers, so there is nothing to show (as upstream).
        expect(restored.getRightPanelVisible()).toBe(false);
        second.h.dispose();
    });
});
