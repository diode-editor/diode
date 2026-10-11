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

/**
 * `workbench.tree.expandMode` до кадра: настоящее дерево Explorer'а над
 * настоящим диском, настройки с дефолтами приложения. Строки: «docs» (папка с
 * цепочкой a/b), «src» (папка), «README.md». Имя папки — с колонки 3
 * (отступ 1, шеврон, пробел).
 */
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

    /** Даёт дереву дочитать каталог с диска и проверяет кадр. */
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

    it("дефолт — singleClick, как у эталона", () => {
        expect(config.get("workbench.tree.expandMode")).toBe("singleClick");
    });

    describe("singleClick", () => {
        it("клик по имени папки раскрывает её, второй клик сворачивает", async () => {
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

        it("Enter на папке раскрывает её", async () => {
            app.sendKey("ArrowDown"); // src
            app.sendKey("Enter");
            await expectFrame((text) => {
                expect(text).toContain("main.ts");
            });
            expect(opened).toEqual([]);
        });

        it("клик по файлу его не открывает — открывают Enter и двойной клик", async () => {
            click(4, 2); // README.md
            frame();
            expect(opened).toEqual([]);
            app.sendKey("Enter");
            expect(opened).toEqual([ws.path("README.md")]);
        });

        it("клик по сегменту компактной строки делает его текущим и сворачивает строку", async () => {
            click(4, 0); // docs → раскрывается и сжимается в «docs/a/b»
            await expectFrame((text) => {
                expect(text).toContain("docs/a/b");
                expect(text).toContain("x.md");
            });
            // « ▾ docs/a/b»: «docs» — колонки 3–6, «a» — колонка 8.
            click(8, 0);
            await expectFrame((text) => {
                expect(text).not.toContain("x.md");
            });
            expect(service.getSelectedPaths()).toEqual([ws.path("docs/a")]);
        });
    });

    describe("doubleClick", () => {
        it("клик по имени и Enter папку не раскрывают; правка настройки действует сразу", async () => {
            await config.updateValue("workbench.tree.expandMode", "doubleClick");

            click(4, 1); // src
            app.sendKey("Enter");
            // Раскрытие асинхронное: дадим ему шанс случиться, прежде чем утверждать «нет».
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(frame()).not.toContain("main.ts");

            // Дерево не пересоздаётся: предикат читает настройку на каждом жесте.
            await config.updateValue("workbench.tree.expandMode", "singleClick");
            click(4, 1);
            await expectFrame((text) => {
                expect(text).toContain("main.ts");
            });
        });
    });
});
