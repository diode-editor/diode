import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
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
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { MENU_CONTRIBUTIONS } from "../../../workbench.common.main.ts";

import { ExplorerComponent } from "./explorerComponent.ts";
import { ExplorerService } from "./explorerService.ts";

/** Rows: "docs" (folder with an a/b chain), "src", "README.md"; a folder name starts at column 3 (indent 1, chevron, space). */
describe("ExplorerComponent — workbench.tree.expandMode", () => {
    let ws: ITempWorkspace;
    let config: InMemoryConfigurationService;
    let service: ExplorerService;
    let component: ExplorerComponent;
    let app: TestApp;
    let opened: string[];

    function frame(): string {
        app.render();
        return app.backend.screenToString();
    }

    function click(x: number, y: number): void {
        app.focusedElement?.dispatchEvent(
            new TUIMouseEvent("click", { button: "left", screenX: x, screenY: y, localX: x, localY: y }),
        );
    }

    async function expectFrame(check: (text: string) => void): Promise<void> {
        await vi.waitFor(() => {
            check(frame());
        });
    }

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "diode-explorer-expand-",
            files: { "docs/a/b/x.md": "", "src/main.ts": "", "README.md": "" },
        });
        config = createTestConfigurationService();
        const clipboard = new InMemoryFileClipboard();
        service = new ExplorerService(clipboard, config, diskFileService(), NULL_TREE_FILE_WATCHER);
        const commands = new CommandRegistry();
        opened = [];
        commands.register("workbench.openFile", (filePath) => {
            opened.push(filePath as string);
        });
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
        );
        service.setRootPath(ws.dir);
        app = TestApp.createWithContent(component.view, new Size(40, 12));
        service.focus();
        await service.refresh();
    });

    afterEach(() => {
        component.dispose();
        service.dispose();
        ws.dispose();
    });

    it("defaults to singleClick, as upstream", () => {
        expect(config.get("workbench.tree.expandMode")).toBe("singleClick");
    });

    describe("singleClick", () => {
        it("clicking a folder name expands it, a second click collapses it", async () => {
            click(4, 1); // src
            await expectFrame((text) => {
                expect(text).toContain("main.ts");
            });
            click(4, 1);
            await expectFrame((text) => {
                expect(text).not.toContain("main.ts");
            });
            expect(opened).toEqual([]);
        });

        it("Enter on a folder expands it", async () => {
            app.sendKey("ArrowDown"); // src
            app.sendKey("Enter");
            await expectFrame((text) => {
                expect(text).toContain("main.ts");
            });
            expect(opened).toEqual([]);
        });

        it("clicking a file does not open it — Enter and double click do", async () => {
            click(4, 2); // README.md
            frame();
            expect(opened).toEqual([]);
            app.sendKey("Enter");
            expect(opened).toEqual([ws.path("README.md")]);
        });

        it("clicking a compact row segment makes it current and collapses the row", async () => {
            click(4, 0); // docs → expands and compacts into "docs/a/b"
            await expectFrame((text) => {
                expect(text).toContain("docs/a/b");
                expect(text).toContain("x.md");
            });
            // " ▾ docs/a/b": "docs" is columns 3–6, "a" is column 8.
            click(8, 0);
            await expectFrame((text) => {
                expect(text).not.toContain("x.md");
            });
            expect(service.getSelectedPaths()).toEqual([ws.path("docs/a")]);
        });
    });

    describe("doubleClick", () => {
        it("clicking the name and Enter do not expand the folder; editing the setting applies right away", async () => {
            await config.updateValue("workbench.tree.expandMode", "doubleClick");

            click(4, 1); // src
            app.sendKey("Enter");
            // Expansion is async: give it a chance to happen before asserting it didn't.
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(frame()).not.toContain("main.ts");

            // The tree isn't recreated: the predicate reads the setting on every gesture.
            await config.updateValue("workbench.tree.expandMode", "singleClick");
            click(4, 1);
            await expectFrame((text) => {
                expect(text).toContain("main.ts");
            });
        });
    });
});
