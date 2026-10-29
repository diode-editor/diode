import * as path from "node:path";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { FakeTerminalSurface } from "../../../TestUtils/FakeTerminalSurface.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { EXTENSIONS_VIEWLET_ID } from "../contrib/extensions/browser/extensionsComponent.ts";
import { EXPLORER_VIEWLET_ID } from "../contrib/files/browser/explorerComponent.ts";
import { SCM_GRAPH_VIEW_ID } from "../contrib/scm/common/scmViews.ts";
import { TerminalServiceDIToken } from "../contrib/terminal/browser/terminalService.ts";
import type { ITerminalSessionOptions } from "../contrib/terminal/common/terminalSessionFactory.ts";
import { TerminalSessionFactoryDIToken } from "../contrib/terminal/common/terminalSessionFactory.ts";

import { SidebarServiceDIToken } from "./parts/sidebar/sidebarService.ts";
import type { PaneViewElement } from "./parts/views/paneViewElement.ts";

describe("Workbench — window without a workspace", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let terminalOptions: ITerminalSessionOptions[];

    function screen(): string {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    }

    function welcomeButton(): ButtonElement {
        const welcome = h.testApp.querySelector("#viewPlaceholder-workbench-explorer-fileView");
        const buttons = (welcome?.getChildren() ?? []).filter((child) => child instanceof ButtonElement);
        expect(buttons).toHaveLength(1);
        return buttons[0];
    }

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-empty-window-", files: { "alpha.txt": "Alpha" } });
        terminalOptions = [];
        h = createAppTestHarness({
            size: new Size(80, 24),
            containerOverrides: (container) => {
                container.bind(TerminalSessionFactoryDIToken, () => (options: ITerminalSessionOptions) => {
                    terminalOptions.push(options);
                    return new FakeTerminalSurface();
                });
            },
        });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("the sidebar is built and shows Explorer with a welcome view instead of the tree", () => {
        expect(h.container.get(SidebarServiceDIToken).getActiveViewletId()).toBe(EXPLORER_VIEWLET_ID);
        const shown = screen();
        // Upstream's empty-window view name; with one section it is the sidebar header (#898).
        expect(shown).toContain("NO FOLDER OPENED");
        expect(shown).toContain("You have not yet opened a");
        expect(shown).toContain("[ Open Folder ]");
    });

    it("the welcome button leads to the same Open Folder command as the keybinding", () => {
        const button = welcomeButton();
        const ran: string[] = [];
        // Stub the command itself: the test covers the "button → command" route, not
        // the path input dialog (fileActions covers that).
        h.commands.register("workbench.action.files.openFolder", () => {
            ran.push("openFolder");
        });

        button.onActivate?.();

        expect(ran).toEqual(["openFolder"]);
    });

    it("Explorer focus in an empty window sits on the welcome button — one Enter to get out", () => {
        h.commands.execute("workbench.view.explorer");

        expect(h.testApp.focusedElement).toBe(welcomeButton());
    });

    it("Search without a folder does not pretend to search — an honest empty state", () => {
        h.commands.execute("workbench.view.search");
        const shown = screen();
        expect(shown).toContain("SEARCH");
        expect(shown).toContain("Search needs an open folder.");
        expect(shown).toContain("[ Open Folder ]");
    });

    it("Source Control without a folder also says what is missing", () => {
        h.commands.execute("workbench.view.scm");
        const shown = screen();
        expect(shown).toContain("To use source control, open a");
        expect(shown).toContain("[ Open Folder ]");
    });

    it("GRAPH without a folder — a hint instead of an empty history, and no second button", () => {
        h.commands.execute("workbench.view.scm");
        // The section is collapsed by default; its body is hidden until expanded.
        const paneView = h.testApp.querySelector("#viewContainer-scm") as PaneViewElement;
        paneView.setCollapsed(SCM_GRAPH_VIEW_ID, false);

        const shown = screen();
        expect(shown).toContain("No folder opened.");
        expect(shown.split("[ Open Folder ]")).toHaveLength(2);
    });

    it("the other viewlets are in place too — the marketplace opens without a folder", () => {
        h.commands.execute("workbench.view.extensions");
        expect(h.container.get(SidebarServiceDIToken).getActiveViewletId()).toBe(EXTENSIONS_VIEWLET_ID);
        const shown = screen();
        expect(shown).toContain("EXTENSIONS");
        expect(shown).toContain("Search Extensions");
    });

    it("opens no editors", () => {
        expect(h.container.get(SidebarServiceDIToken).getActiveViewletId()).not.toBeNull();
        expect(h.testApp.querySelectorAll("TreeViewElement")).toHaveLength(0);
    });

    // Deliberately without `activate()`: Open Folder does not call it, and `TreeViewElement` loads
    // nodes only via refresh(); without the refresh in setWorkspaceFolder the tree is empty.
    it("Open Folder from an empty window populates the tree, not just removes the hint", async () => {
        h.workbench.setWorkspaceFolder(ws.dir);
        await h.workbench.fileIndexReady;
        await vi.waitFor(() => {
            expect(screen()).toContain("alpha.txt");
        });

        const shown = screen();
        // The header is renamed after the opened folder at once, without a restart.
        expect(shown).toContain(path.basename(ws.dir).toUpperCase());
        expect(shown).not.toContain("NO FOLDER OPENED");
        expect(shown).not.toContain("You have not yet opened a");
    });

    it("Open Folder also unlocks Search and Source Control — their welcome goes away", () => {
        h.workbench.setWorkspaceFolder(ws.dir);

        h.commands.execute("workbench.view.search");
        expect(screen()).not.toContain("Search needs an open folder.");
        h.commands.execute("workbench.view.scm");
        expect(screen()).not.toContain("To use source control, open a");
    });

    // Producer test for `terminalService.setWorkingDirectory` in setWorkspaceFolder.
    it("new terminals start in the opened folder, not in the process cwd", () => {
        const terminals = h.container.get(TerminalServiceDIToken);
        terminals.newTerminal();
        expect(terminalOptions.at(-1)?.cwd).toBe(process.cwd());

        h.workbench.setWorkspaceFolder(ws.dir);
        terminals.newTerminal();
        expect(terminalOptions.at(-1)?.cwd).toBe(ws.dir);
    });
});
