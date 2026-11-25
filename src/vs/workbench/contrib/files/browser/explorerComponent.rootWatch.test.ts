import * as fs from "node:fs";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, describe, expect, it, vi } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { MenuRegistry } from "../../../../platform/actions/common/menuRegistry.ts";
import { MenuService } from "../../../../platform/actions/common/menuService.ts";
import { InMemoryFileClipboard } from "../../../../platform/clipboard/common/inMemoryFileClipboard.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import type { ITreeFileChange, ITreeFileWatcher } from "../../../../platform/files/common/iTreeFileWatcher.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { WorkspaceContextService } from "../../../../platform/workspace/common/workspaceContextService.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { MENU_CONTRIBUTIONS } from "../../../workbench.common.main.ts";

import { ExplorerComponent } from "./explorerComponent.ts";
import { ExplorerService } from "./explorerService.ts";

/**
 * The workspace root is watched without being expanded (#1263): entries created next to the
 * top-level rows outside the editor show up in the frame. A real tree over a real disk; the watcher
 * is a fake that delivers what the test fires — like the subprocess watcher would.
 */
describe("ExplorerComponent — changes in the workspace root", () => {
    let ws: ITempWorkspace;
    let service: ExplorerService;
    let component: ExplorerComponent;
    let app: TestApp;
    let listeners: Map<string, (changes: readonly ITreeFileChange[]) => void>;

    async function open(files: Record<string, string>): Promise<void> {
        ws = createTempWorkspace({ prefix: "diode-explorer-root-", files });
        listeners = new Map();
        const watcher: ITreeFileWatcher = {
            watchTree: (dirPath, _options, onChanges) => {
                listeners.set(dirPath, onChanges);
                return {
                    dispose: () => {
                        listeners.delete(dirPath);
                    },
                };
            },
        };
        const clipboard = new InMemoryFileClipboard();
        const config = createTestConfigurationService();
        service = new ExplorerService(clipboard, config, diskFileService(), watcher);
        const commands = new CommandRegistry();
        component = new ExplorerComponent(
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
        service.setRootPath(ws.dir);
        app = TestApp.createWithContent(component.view, new Size(40, 12));
        service.focus();
        await service.refresh();
    }

    function rows(): string[] {
        app.render();
        return app.backend
            .screenToString()
            .split("\n")
            .map((row) => row.trim())
            .filter((row) => row !== "");
    }

    /** What the watcher reports after an outside change to the root. */
    function fireRoot(...names: string[]): void {
        const onChanges = listeners.get(ws.dir);
        if (!onChanges) throw new Error("the root is not watched");
        onChanges(names.map((name): ITreeFileChange => ({ type: "added", path: ws.path(name) })));
    }

    afterEach(() => {
        component.dispose();
        service.dispose();
        ws.dispose();
    });

    it("a folder and a file created in the root appear in the tree without expanding anything", async () => {
        await open({ "a.txt": "hi", "sub/b.txt": "x" });
        expect(rows()).toEqual([expect.stringMatching(/sub$/), expect.stringMatching(/a\.txt$/)]);

        fs.mkdirSync(ws.path("build"));
        ws.writeFile("rootfile.txt", "");
        fireRoot("build", "rootfile.txt");

        await vi.waitFor(() => {
            expect(rows()).toEqual([
                expect.stringMatching(/build$/),
                expect.stringMatching(/sub$/),
                expect.stringMatching(/a\.txt$/),
                expect.stringMatching(/rootfile\.txt$/),
            ]);
        });
    });

    it("the reread keeps expanded folders expanded and the cursor where it was", async () => {
        await open({ "a.txt": "hi", "sub/b.txt": "x" });
        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("b.txt");
        });
        app.sendKey("ArrowDown");
        expect(service.getSelectedPaths()).toEqual([ws.path("sub/b.txt")]);

        // cmake: `build/` with a pile of files inside — one event batch, the folder shows collapsed.
        fs.mkdirSync(ws.path("build/CMakeFiles"), { recursive: true });
        ws.writeFile("build/CMakeCache.txt", "");
        fireRoot("build");

        await vi.waitFor(() => {
            expect(rows()).toEqual([
                expect.stringMatching(/build$/),
                expect.stringMatching(/sub$/),
                expect.stringMatching(/b\.txt$/),
                expect.stringMatching(/a\.txt$/),
            ]);
        });
        expect(service.getSelectedPaths()).toEqual([ws.path("sub/b.txt")]);
    });

    it("a new folder next to an expanded compact row keeps the row compact and expanded", async () => {
        await open({ "pkg/a/b/C.java": "" });
        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("pkg/a/b");
        });

        fs.mkdirSync(ws.path("build"));
        fireRoot("build");

        await vi.waitFor(() => {
            expect(rows()).toEqual([
                expect.stringMatching(/build$/),
                expect.stringMatching(/pkg\/a\/b$/),
                expect.stringMatching(/C\.java$/),
            ]);
        });
    });

    it("an empty workspace shows its first file", async () => {
        await open({});
        expect(rows()).toEqual([]);

        ws.writeFile("first.txt", "");
        fireRoot("first.txt");

        await vi.waitFor(() => {
            expect(rows()).toEqual([expect.stringMatching(/first\.txt$/)]);
        });
    });

    it("changing the root drops the old root's subscription and watches the new one", async () => {
        await open({ "a.txt": "" });
        const other = createTempWorkspace({ prefix: "diode-explorer-root-other-", files: { "z.txt": "" } });
        try {
            service.setRootPath(other.dir);
            expect([...listeners.keys()]).toEqual([other.dir]);
        } finally {
            other.dispose();
        }
    });
});
