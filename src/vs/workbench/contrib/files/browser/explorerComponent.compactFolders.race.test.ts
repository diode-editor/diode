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
 * Гонка, на которой редактор висел (большое монорепо, `explorer.autoReveal`): раскрытие головы
 * цепочки ждёт ФС, а родителя перечитывают — строку держит новый объект без цепочки, и
 * `revealChain` крутился на голове микротасками, не отдавая event loop.
 */
describe("ExplorerComponent — compactFolders: reveal после перечитывания родителя посреди раскрытия", () => {
    let ws: ITempWorkspace;
    let service: ExplorerService;
    let component: ExplorerComponent;
    let app: TestApp;
    /** Отпускает чтение `pkg/a/b`, которое держит спуск по цепочке. */
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

    /** Цикл на микротасках таймаут vitest не прервёт — ограничиваем обращения к `findNode`, чтобы регрессия падала, а не вешала прогон. */
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
        // Раскрываем «pkg»: спуск pkg → pkg/a → pkg/a/b застревает на шлюзе.
        app.sendKey("ArrowRight");
        await gateReached;
        // Тем временем корень перечитывают (событие наблюдателя, refresh):
        // строку «pkg» теперь держит новый объект листинга.
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
