import * as path from "node:path";

import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import type { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { InMemoryFileClipboard } from "../../../../platform/clipboard/common/inMemoryFileClipboard.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { NULL_TREE_FILE_WATCHER } from "../../../../platform/files/common/iTreeFileWatcher.ts";
import type { IViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { makeViewsHarness, paneTitles, testView } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { ViewWelcomeElement } from "../../../browser/parts/views/viewWelcomeElement.ts";
import { MENU_CONTRIBUTIONS } from "../../../workbench.common.main.ts";

import { EXPLORER_VIEW_ID, EXPLORER_VIEWLET_ID, ExplorerComponent } from "./explorerComponent.ts";
import { ExplorerService } from "./explorerService.ts";

/** The component draws nothing itself: the header, "⋯" menu and buttons come from the shared container model. */
describe("ExplorerComponent — sidebar container", () => {
    let ws: ITempWorkspace;
    let h: IViewsHarness;
    let service: ExplorerService;
    let component: ExplorerComponent;

    function attach(): void {
        h.service.registerContainer({ id: EXPLORER_VIEWLET_ID, title: "EXPLORER", location: "sidebar" });
        h.service.attachContainer(EXPLORER_VIEWLET_ID);
        h.showViewlet(EXPLORER_VIEWLET_ID);
    }

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-explorer-container-", files: { "index.ts": "" } });
        h = makeViewsHarness(MENU_CONTRIBUTIONS);
        const clipboard = new InMemoryFileClipboard();
        service = new ExplorerService(clipboard, NULL_CONFIGURATION_SERVICE, diskFileService(), NULL_TREE_FILE_WATCHER);
        component = new ExplorerComponent(
            service,
            new CommandRegistry(),
            clipboard,
            new ContextMenuService(h.menuService),
            h.service,
            NULL_CONFIGURATION_SERVICE,
            h.workspace,
        );
    });

    afterEach(() => {
        component.dispose();
        service.dispose();
        ws.dispose();
    });

    function mergedTitle(): unknown {
        return paneTitles(h.paneView(EXPLORER_VIEWLET_ID)).at(0);
    }

    it("merged container: the single section header is the folder name and does not collapse", () => {
        h.workspace.setWorkspaceFolder(path.join(ws.dir, "my-App"));
        service.setRootPath(ws.dir);
        attach();

        expect(h.header(EXPLORER_VIEWLET_ID)).toBeNull();
        const paneView = h.paneView(EXPLORER_VIEWLET_ID);
        expect(paneView.getPaneIds()).toEqual([EXPLORER_VIEW_ID]);
        expect(paneView.querySelector("#paneHeader-workbench-explorer-fileView")?.inspectState()).toMatchObject({
            title: "MY-APP",
            collapsible: false,
        });
        expect(h.service.canMoveView(EXPLORER_VIEW_ID)).toBe(true);
    });

    it("without a folder the section is NO FOLDER OPENED; opening one renames it at once, collapsed state intact", () => {
        attach();
        expect(mergedTitle()).toBe("NO FOLDER OPENED");

        h.workspace.setWorkspaceFolder(path.join(ws.dir, "проект"));
        expect(mergedTitle()).toBe("ПРОЕКТ");
        h.workspace.setWorkspaceFolder(path.join(ws.dir, "other"));
        expect(mergedTitle()).toBe("OTHER");
    });

    it("a .code-workspace window is named like the window title, upper-cased", () => {
        h.workspace.setWorkspaceFile(path.join(ws.dir, "web.code-workspace"), { folder: ws.dir, folderName: "src" });
        attach();
        expect(mergedTitle()).toBe("WEB (WORKSPACE)");
    });

    it("with a second visible section the folder name moves to the section, the header is EXPLORER", () => {
        h.workspace.setWorkspaceFolder(ws.dir);
        attach();
        h.service.registerView(testView("workbench.explorer.other", EXPLORER_VIEWLET_ID, 20));
        expect(h.header(EXPLORER_VIEWLET_ID)!.inspectState()).toMatchObject({ title: "EXPLORER" });
        expect(paneTitles(h.paneView(EXPLORER_VIEWLET_ID))).toEqual([
            path.basename(ws.dir).toUpperCase(),
            "WORKBENCH.EXPLORER.OTHER",
        ]);
    });

    it("before a folder is opened the section renders the welcome with an Open Folder button, after — the tree", () => {
        attach();
        const paneView = h.paneView(EXPLORER_VIEWLET_ID);
        const placeholder = paneView.querySelector("#viewPlaceholder-workbench-explorer-fileView");
        expect(placeholder).toBeInstanceOf(ViewWelcomeElement);
        const button = (placeholder?.getChildren() ?? []).find((child) => child instanceof ButtonElement)!;
        expect(button.getLabel()).toBe("Open Folder");

        service.setRootPath(ws.dir);
        expect(paneView.querySelector("#explorerView")).toBe(component.view);
        expect(paneView.querySelector("#viewPlaceholder-workbench-explorer-fileView")).toBeNull();
    });

    it("changing the root swaps the body in place — the sidebar keeps the same container root", () => {
        service.setRootPath(ws.dir);
        attach();
        const root = h.root(EXPLORER_VIEWLET_ID);
        const firstBody = component.view;

        const other = createTempWorkspace({ prefix: "diode-explorer-container-2-", files: { "a.ts": "" } });
        service.setRootPath(other.dir);

        expect(h.root(EXPLORER_VIEWLET_ID)).toBe(root);
        expect(component.view).not.toBe(firstBody);
        expect(h.paneView(EXPLORER_VIEWLET_ID).querySelector("#explorerView")).toBe(component.view);
        other.dispose();
    });

    it("the header carries New File / New Folder / Refresh buttons", () => {
        service.setRootPath(ws.dir);
        attach();
        const header = h.paneView(EXPLORER_VIEWLET_ID).querySelector("#paneHeader-workbench-explorer-fileView")!;
        const [, ...rest] = header.querySelectorAll("TextLabelElement");
        const buttons = rest
            .filter((label) => label.id !== "viewTitleSwitcher")
            .map((label) => (label as TextLabelElement).getText().trim())
            .filter((text) => text !== "\u2502");
        // New File / New Folder / Refresh Explorer and "⋯", which holds the viewlet's "Move To".
        expect(buttons).toEqual(["\uEA7F", "\uEA80", "\uEB37", "⋯"]);
    });

    it("the merged section's '⋯' holds the container submenu, not the header items", () => {
        service.setRootPath(ws.dir);
        attach();
        h.paneView(EXPLORER_VIEWLET_ID).onDidRequestPaneMenu?.(EXPLORER_VIEW_ID, { screenX: 0, screenY: 0 });
        // Explorer has no overflow items of its own — "⋯" holds only the container submenu with "Move To".
        const entries = h.shown.at(-1)!.getEntries!();
        expect(entries.map((entry) => (entry.type === "separator" ? "---" : entry.label))).toEqual(["EXPLORER"]);
    });
});
