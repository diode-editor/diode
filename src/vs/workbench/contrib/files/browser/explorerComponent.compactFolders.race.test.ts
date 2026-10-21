import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { NULL_TREE_FILE_WATCHER } from "../../../../platform/files/common/iTreeFileWatcher.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { MENU_CONTRIBUTIONS } from "../../../workbench.common.main.ts";

import { ExplorerComponent } from "./explorerComponent.ts";
import { ExplorerService } from "./explorerService.ts";
import type { FileTreeDataProvider } from "./fileTreeDataProvider.ts";

/**
 * The race that hung the editor (large monorepo, `explorer.autoReveal`): expanding the chain head
 * waits on the FS while the parent is reread — the row is now held by a new object without a chain,
 * and `revealChain` spun on the head in microtasks, never yielding the event loop.
 */
describe("ExplorerComponent — compactFolders: reveal после перечитывания родителя посреди раскрытия", () => {
    let ws: ITempWorkspace;
    let service: ExplorerService;
    let component: ExplorerComponent;
    let app: TestApp;
    /** Releases the read of `pkg/a/b` that holds the descent along the chain. */
    let releaseGate: () => void;
    let gateReached: Promise<void>;

    function rows(): string[] {
        app.render();
        return app.backend
            .screenToString()
            .split("\n")
            .map((row) => row.trimEnd())
            .filter((row) => row.trim() !== "");
    }

    /** The vitest timeout can't break a microtask loop — cap `findNode` calls so a regression fails instead of hanging the run. */
    function failInsteadOfHanging(provider: FileTreeDataProvider): void {
        const findNode = provider.findNode.bind(provider);
        let calls = 0;
        vi.spyOn(provider, "findNode").mockImplementation((dirPath) => {
            if (++calls > 1000) throw new Error("revealChain не продвигается по дереву");
            return findNode(dirPath);
        });
    }

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "diode-explorer-compact-race-",
            files: { "pkg/a/b/C.java": "", "pkg/a/b/D.java": "", "README.md": "" },
        });
        const files = diskFileService();
        const resolve = files.resolve.bind(files);
        const gate = new Promise<void>((resolveGate) => {
            releaseGate = resolveGate;
        });
        let reached!: () => void;
        gateReached = new Promise<void>((resolveReached) => {
            reached = resolveReached;
        });
        const gated = ws.path("pkg/a/b");
        vi.spyOn(files, "resolve").mockImplementation(async (uri) => {
            if (uri.fsPath === gated) {
                reached();
                await gate;
            }
            return resolve(uri);
        });

        const config = createTestConfigurationService();
        const clipboard = new InMemoryFileClipboard();
        service = new ExplorerService(clipboard, config, files, NULL_TREE_FILE_WATCHER);
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
        );
        service.setRootPath(ws.dir);
        app = TestApp.createWithContent(component.view, new Size(40, 12));
        service.focus();
        await service.refresh();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        component.dispose();
        service.dispose();
        ws.dispose();
    });

    async function expandHeadWhileParentIsReread(): Promise<void> {
        expect(rows()[0]).toMatch(/pkg$/);
        // Expand "pkg": the descent pkg → pkg/a → pkg/a/b gets stuck at the gate.
        app.sendKey("ArrowRight");
        await gateReached;
        // Meanwhile the root is reread (watcher event, refresh):
        // the "pkg" row is now held by a new listing object.
        await service.refresh();
        releaseGate();
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("C.java");
        });
    }

    it("строка, перечитанная посреди раскрытия, всё равно показывает цепочку «pkg/a/b»", async () => {
        await expandHeadWhileParentIsReread();
        const frame = rows();
        expect(frame[0]).toMatch(/pkg\/a\/b$/);
        expect(frame.join("\n")).toContain("D.java");
    });

    it("reveal файла в цепочке завершается и выделяет файл", async () => {
        await expandHeadWhileParentIsReread();
        if (!service.provider) throw new Error("провайдер не создан");
        failInsteadOfHanging(service.provider);

        const target = ws.path("pkg/a/b/C.java");
        await expect(service.revealPath(target)).resolves.toBe(true);
        expect(service.getSelectedPaths()).toEqual([target]);
    });
});
