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

describe("Workbench — окно без воркспейса", () => {
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

    it("сайдбар собран и показывает Explorer с welcome вместо дерева", () => {
        expect(h.container.get(SidebarServiceDIToken).getActiveViewletId()).toBe(EXPLORER_VIEWLET_ID);
        const shown = screen();
        expect(shown).toContain("EXPLORER");
        expect(shown).toContain("You have not yet opened a");
        expect(shown).toContain("[ Open Folder ]");
    });

    it("кнопка welcome ведёт в ту же команду Open Folder, что и бинд", () => {
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

    it("фокус Explorer'а в пустом окне стоит на кнопке welcome — выход одним Enter'ом", () => {
        h.commands.execute("workbench.view.explorer");

        expect(h.testApp.focusedElement).toBe(welcomeButton());
    });

    it("Search без папки не делает вид, что ищет, — честное пустое состояние", () => {
        h.commands.execute("workbench.view.search");
        const shown = screen();
        expect(shown).toContain("SEARCH");
        expect(shown).toContain("Search needs an open folder.");
        expect(shown).toContain("[ Open Folder ]");
    });

    it("Source Control без папки тоже говорит, чего не хватает", () => {
        h.commands.execute("workbench.view.scm");
        const shown = screen();
        expect(shown).toContain("To use source control, open a");
        expect(shown).toContain("[ Open Folder ]");
    });

    it("GRAPH без папки — подсказка вместо пустой истории, и без второй кнопки", () => {
        h.commands.execute("workbench.view.scm");
        // The section is collapsed by default; its body is hidden until expanded.
        const paneView = h.testApp.querySelector("#viewContainer-scm") as PaneViewElement;
        paneView.setCollapsed(SCM_GRAPH_VIEW_ID, false);

        const shown = screen();
        expect(shown).toContain("No folder opened.");
        expect(shown.split("[ Open Folder ]")).toHaveLength(2);
    });

    it("остальные вьюлеты тоже на месте — магазин открывается без папки", () => {
        h.commands.execute("workbench.view.extensions");
        expect(h.container.get(SidebarServiceDIToken).getActiveViewletId()).toBe(EXTENSIONS_VIEWLET_ID);
        const shown = screen();
        expect(shown).toContain("EXTENSIONS");
        expect(shown).toContain("Search Extensions");
    });

    it("не открывает ни одного редактора", () => {
        expect(h.container.get(SidebarServiceDIToken).getActiveViewletId()).not.toBeNull();
        expect(h.testApp.querySelectorAll("TreeViewElement")).toHaveLength(0);
    });

    // Deliberately without `activate()`: Open Folder does not call it, and `TreeViewElement` loads
    // nodes only via refresh(); without the refresh in setWorkspaceFolder the tree is empty.
    it("Open Folder из пустого окна наполняет дерево, а не просто убирает подсказку", async () => {
        h.workbench.setWorkspaceFolder(ws.dir);
        await h.workbench.fileIndexReady;
        await vi.waitFor(() => {
            expect(screen()).toContain("alpha.txt");
        });

        const shown = screen();
        expect(shown).toContain("EXPLORER");
        expect(shown).not.toContain("You have not yet opened a");
    });

    it("Open Folder расклеивает и Search с Source Control — их welcome уходит", () => {
        h.workbench.setWorkspaceFolder(ws.dir);

        h.commands.execute("workbench.view.search");
        expect(screen()).not.toContain("Search needs an open folder.");
        h.commands.execute("workbench.view.scm");
        expect(screen()).not.toContain("To use source control, open a");
    });

    // Producer test for `terminalService.setWorkingDirectory` in setWorkspaceFolder.
    it("новые терминалы поднимаются в открытой папке, а не в cwd процесса", () => {
        const terminals = h.container.get(TerminalServiceDIToken);
        terminals.newTerminal();
        expect(terminalOptions.at(-1)?.cwd).toBe(process.cwd());

        h.workbench.setWorkspaceFolder(ws.dir);
        terminals.newTerminal();
        expect(terminalOptions.at(-1)?.cwd).toBe(ws.dir);
    });
});
