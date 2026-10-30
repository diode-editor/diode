import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { MenuRegistry } from "../../../../platform/actions/common/menuRegistry.ts";
import { MenuService } from "../../../../platform/actions/common/menuService.ts";
import { InMemoryFileClipboard } from "../../../../platform/clipboard/common/inMemoryFileClipboard.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { NULL_TREE_FILE_WATCHER } from "../../../../platform/files/common/iTreeFileWatcher.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { WorkspaceContextService } from "../../../../platform/workspace/common/workspaceContextService.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { MENU_CONTRIBUTIONS } from "../../../workbench.common.main.ts";

import { ExplorerComponent } from "./explorerComponent.ts";
import { ExplorerService } from "./explorerService.ts";

const GUIDE = "│";

function move(x: number, y: number): MouseToken {
    // Mouse tokens are 1-based.
    return {
        kind: "mouse",
        button: "none",
        x: x + 1,
        y: y + 1,
        action: "move",
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

/**
 * Rows once src and src/lib are expanded and the cursor is on a.ts:
 *   0 " ▾ src"      1 " │ ▾ lib"     2 " │ │   a.ts"     3 " │   main.ts"     4 "   README.md"
 * src's guide is column 1, lib's guide is column 3.
 */
describe("ExplorerComponent — workbench.tree.renderIndentGuides", () => {
    let ws: ITempWorkspace;
    let config: InMemoryConfigurationService;
    let service: ExplorerService;
    let component: ExplorerComponent;
    let app: TestApp;
    const theme = WorkbenchTheme.fromThemeFile(darkPlusTheme);

    /** Guide columns of a screen row. */
    function guides(y: number): number[] {
        app.render();
        const columns: number[] = [];
        for (let x = 0; x < 30; x++) if (app.backend.getTextAt(new Point(x, y), 1) === GUIDE) columns.push(x);
        return columns;
    }

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "diode-explorer-guides-",
            files: { "src/lib/a.ts": "", "src/main.ts": "", "README.md": "" },
        });
        config = createTestConfigurationService();
        const clipboard = new InMemoryFileClipboard();
        service = new ExplorerService(clipboard, config, diskFileService(), NULL_TREE_FILE_WATCHER);
        const commands = new CommandRegistry();
        const contextMenuService = new ContextMenuService(
            new MenuService(
                new MenuRegistry(commands, new KeybindingRegistry(), new ContextKeyService(), MENU_CONTRIBUTIONS),
            ),
        );
        component = new ExplorerComponent(
            service,
            commands,
            clipboard,
            contextMenuService,
            makeViewsHarness().service,
            config,
            new WorkspaceContextService(),
        );
        service.setRootPath(ws.dir);
        app = TestApp.createWithContent(component.view, new Size(30, 10));
        service.focus();
        await service.refresh();
        app.sendKey("ArrowRight"); // expand src
        await vi.waitFor(() => {
            expect(app.backend.screenToString()).toContain("lib");
            app.render();
        });
        app.sendKey("ArrowDown"); // lib
        app.sendKey("ArrowRight"); // expand lib
        await vi.waitFor(() => {
            app.render();
            expect(app.backend.screenToString()).toContain("a.ts");
        });
        app.sendKey("ArrowDown"); // a.ts
    });

    afterEach(() => {
        component.dispose();
        service.dispose();
        ws.dispose();
    });

    it("defaults to onHover, as upstream", () => {
        expect(config.get("workbench.tree.renderIndentGuides")).toBe("onHover");
    });

    it("onHover: only the cursor's parent guide without the mouse, painted in tree.indentGuidesStroke", () => {
        expect(guides(1)).toEqual([]);
        expect(guides(2)).toEqual([3]);
        expect(guides(3)).toEqual([]);
        expect(app.backend.getFgAt(new Point(3, 2))).toBe(theme.getRequiredColor("tree.indentGuidesStroke"));
    });

    it("onHover: the pointer over the empty area shows the inactive guides, mouseleave hides them", () => {
        app.backend.simulateMouse(move(10, 8));
        expect(guides(1)).toEqual([1]);
        expect(guides(2)).toEqual([1, 3]);
        expect(guides(3)).toEqual([1]);

        app.focusedElement?.dispatchEvent(
            new TUIMouseEvent("mouseleave", { button: "left", screenX: 10, screenY: 8, localX: 10, localY: 8 }),
        );
        expect(guides(2)).toEqual([3]);
        expect(guides(3)).toEqual([]);
    });

    it("editing the setting repaints the tree at once", async () => {
        app.render();
        await config.updateValue("workbench.tree.renderIndentGuides", "always");
        expect(guides(2)).toEqual([1, 3]);
        expect(guides(4)).toEqual([]);

        await config.updateValue("workbench.tree.renderIndentGuides", "none");
        expect(guides(2)).toEqual([]);
        expect(app.backend.getTextAt(new Point(0, 2), 5)).toBe("     ");
    });
});

describe("ExplorerComponent — workbench.tree.renderIndentGuides without a folder", () => {
    it("a settings change before any folder is open is harmless", async () => {
        const config = createTestConfigurationService();
        const clipboard = new InMemoryFileClipboard();
        const service = new ExplorerService(clipboard, config, diskFileService(), NULL_TREE_FILE_WATCHER);
        const commands = new CommandRegistry();
        const component = new ExplorerComponent(
            service,
            commands,
            clipboard,
            new ContextMenuService(
                new MenuService(
                    new MenuRegistry(commands, new KeybindingRegistry(), new ContextKeyService(), MENU_CONTRIBUTIONS),
                ),
            ),
            makeViewsHarness().service,
            config,
            new WorkspaceContextService(),
        );
        await expect(config.updateValue("workbench.tree.renderIndentGuides", "always")).resolves.toBeUndefined();
        component.dispose();
        service.dispose();
    });
});
