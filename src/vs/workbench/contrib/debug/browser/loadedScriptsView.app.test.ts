// LOADED SCRIPTS on the whole workbench with the synthetic debugger: the section comes with a session whose adapter
// has `loadedSources` and goes with it, shows the sources by folder, Enter opens one, Collapse All folds the tree;
// Debug: Open Loaded Script... lists them in the quick input.

import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { LOADED_SCRIPTS_VIEW_ID, VIEWLET_ID } from "../common/debug.ts";

import { DebugServiceDIToken } from "./debugService.ts";
import { DebugViewletComponentDIToken } from "./debugViewlet.ts";
import {
    type BaseTreeItem,
    LOADED_SCRIPTS_REFRESH_DELAY_MS,
    type LoadedScriptsView,
    SessionTreeItem,
} from "./loadedScriptsView.ts";

/** The synthetic program's sources, outside the workspace and the home of the test's user. */
const FOLDER = "/home/user/hello/src";

describe("LOADED SCRIPTS in the workbench", () => {
    let h: IAppHarness;
    let registration: (IDisposable & { factory: SyntheticDebugAdapterFactory }) | undefined;

    beforeEach(async () => {
        h = createAppTestHarness({ size: new Size(120, 50) });
        await h.workbench.activate();
        registration = undefined;
    });

    afterEach(async () => {
        await h.container.get(DebugServiceDIToken).stopSession(undefined);
        registration?.factory.adapters.forEach((a) => {
            a.dispose();
        });
        registration?.dispose();
        h.dispose();
    });

    function screen(): string {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    }

    async function startStopped(): Promise<void> {
        registration = registerSyntheticDebugger(
            h.container.get(DebugServiceDIToken).getAdapterManager(),
            NO_DELAY_TIMING,
        );
        await h.commands.execute("debug.startFromConfig", { ...SYNTHETIC_LAUNCH_CONFIG });
        await vi.waitFor(() => {
            expect(h.container.get(ContextKeyServiceDIToken).getRaw("debugState")).toBe("stopped");
        });
    }

    async function showLoadedScripts(): Promise<void> {
        const views = h.container.get(ViewsServiceDIToken);
        views.openViewContainer(VIEWLET_ID);
        views.openView(LOADED_SCRIPTS_VIEW_ID, true);
        // The panel leaves the sidebar's sections little room.
        views.closeView("workbench.panel.repl.view");
        await vi.waitFor(
            () => {
                expect(screen()).toContain(FOLDER);
            },
            { timeout: LOADED_SCRIPTS_REFRESH_DELAY_MS * 10 },
        );
    }

    function tree(): LoadedScriptsView["tree"] {
        const view = h.container.get(DebugViewletComponentDIToken).loadedScripts;
        if (view === undefined) throw new Error("no LOADED SCRIPTS");
        return view.tree;
    }

    function row(label: string): BaseTreeItem {
        const item = tree().shownItems.find((i) => i.getLabel() === label);
        if (item === undefined) throw new Error(`no row ${label}`);
        return item;
    }

    it("comes with a session that loads sources and goes when it ends", async () => {
        const views = h.container.get(ViewsServiceDIToken);
        expect(views.getContainerViews(VIEWLET_ID).map((v) => v.id)).not.toContain(LOADED_SCRIPTS_VIEW_ID);
        // Collapse All has no tree to fold yet.
        expect(() => h.commands.execute("loadedScripts.collapse")).not.toThrow();

        await startStopped();
        expect(views.getContainerViews(VIEWLET_ID).map((v) => v.id)).toContain(LOADED_SCRIPTS_VIEW_ID);
        // Collapsed at first, between CALL STACK and BREAKPOINTS.
        expect(views.isViewExpanded(LOADED_SCRIPTS_VIEW_ID)).toBe(false);
        expect(views.canMoveView(LOADED_SCRIPTS_VIEW_ID)).toBe(true);
        const order = views.getContainerViews(VIEWLET_ID).map((v) => v.id);
        expect(order.indexOf(LOADED_SCRIPTS_VIEW_ID)).toBe(order.indexOf("workbench.debug.breakPointsView") - 1);

        await h.container.get(DebugServiceDIToken).stopSession(undefined);
        await vi.waitFor(() => {
            expect(views.getContainerViews(VIEWLET_ID).map((v) => v.id)).not.toContain(LOADED_SCRIPTS_VIEW_ID);
        });
        expect(h.container.get(DebugViewletComponentDIToken).loadedScripts).toBeUndefined();
    });

    it("a key that changes and comes back within one change keeps the section and its tree", async () => {
        await startStopped();
        const viewlet = h.container.get(DebugViewletComponentDIToken);
        const view = viewlet.loadedScripts;
        expect(view).toBeDefined();

        const keys = h.container.get(ContextKeyServiceDIToken);
        keys.set("loadedScriptsSupported", false);
        keys.set("loadedScriptsSupported", true);
        keys.flush();

        expect(viewlet.loadedScripts).toBe(view);
    });

    it("loadedScriptsItemType is 'session' on a session's row, empty on others", async () => {
        await startStopped();
        await h.commands.execute("debug.startFromConfig", { ...SYNTHETIC_LAUNCH_CONFIG, name: "second" });
        const keys = h.container.get(ContextKeyServiceDIToken);
        await vi.waitFor(() => {
            expect(h.container.get(DebugServiceDIToken).getModel().getSessions()).toHaveLength(2);
        });
        // The section reads the sessions' sources when it appears; the synthetic adapter sends no events.
        keys.set("loadedScriptsSupported", false);
        keys.flush();
        keys.set("loadedScriptsSupported", true);
        keys.flush();
        await showLoadedScripts();
        await vi.waitFor(() => {
            expect(tree().shownItems.filter((i) => i instanceof SessionTreeItem)).toHaveLength(2);
        });
        const update = (): void => {
            h.container.get(WorkbenchContextKeysDIToken).update();
        };
        h.container.get(ViewsServiceDIToken).openView(LOADED_SCRIPTS_VIEW_ID, true);
        tree().reveal(row(FOLDER));
        update();
        expect(keys.getRaw("loadedScriptsItemType")).toBe("");

        tree().reveal(row("second"));
        update();
        expect(keys.getRaw("loadedScriptsItemType")).toBe("session");
    });

    it("shows the sources under their folder, Enter opens one, Collapse All folds the folder", async () => {
        await startStopped();
        await showLoadedScripts();

        // One session: no session row. The folder outside the workspace is one row, collapsed as upstream's.
        expect(tree().shownItems.map((i) => i.getLabel())).toEqual([FOLDER]);
        expect(screen()).toContain("LOADED SCRIPTS");

        tree().expand(row(FOLDER));
        await vi.waitFor(() => {
            const text = screen();
            expect(text).toContain("list.cpp");
            expect(text).toContain("queue.cpp");
        });
        expect(tree().shownItems.map((i) => i.getLabel())).toEqual([FOLDER, "list.cpp", "main.cpp", "queue.cpp"]);

        tree().reveal(row("list.cpp"));
        h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(h.container.get(EditorServiceDIToken).getActiveEditor()?.uri.path).toBe(
                "/home/user/hello/src/list.cpp",
            );
        });

        await h.commands.execute("loadedScripts.collapse");
        await vi.waitFor(() => {
            expect(screen()).not.toContain("queue.cpp");
        });
    });

    it("Debug: Open Loaded Script... lists the sources with their session", async () => {
        await startStopped();

        void h.commands.execute("workbench.action.debug.showLoadedScripts");

        await vi.waitFor(() => {
            const text = screen();
            expect(text).toContain("Search loaded scripts by name");
            expect(text).toContain("queue.cpp");
            expect(text).toContain("Launch hello (lldb)");
        });
    });
});
