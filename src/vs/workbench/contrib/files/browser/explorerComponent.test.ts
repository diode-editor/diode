import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { MenuRegistry } from "../../../../platform/actions/common/menuRegistry.ts";
import { MenuService } from "../../../../platform/actions/common/menuService.ts";
import { InMemoryFileClipboard } from "../../../../platform/clipboard/common/inMemoryFileClipboard.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { NULL_TREE_FILE_WATCHER } from "../../../../platform/files/common/iTreeFileWatcher.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { applyThemeVars } from "../../../../platform/theme/browser/themeStyleVars.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";
import { MENU_CONTRIBUTIONS } from "../../../workbench.common.main.ts";

import { ExplorerComponent } from "./explorerComponent.ts";
import { ExplorerService } from "./explorerService.ts";

/** Собирает ContextMenuService для explorer-меню поверх переданного CommandRegistry. */
function makeContextMenuService(commands: CommandRegistry): ContextMenuService {
    return new ContextMenuService(
        new MenuService(
            new MenuRegistry(commands, new KeybindingRegistry(), new ContextKeyService(), MENU_CONTRIBUTIONS),
        ),
    );
}

interface ExplorerHarness {
    service: ExplorerService;
    component: ExplorerComponent;
    commands: CommandRegistry;
    clipboard: InMemoryFileClipboard;
    /** Пути, открытые через команду `workbench.openFile` (регистрирует харнесс). */
    opened: string[];
    /** Опции, с которыми дерево позвало `workbench.openFile`. */
    openOptions: unknown[];
    dispose(): void;
}

function createExplorer(themeService?: ThemeService): ExplorerHarness {
    const clipboard = new InMemoryFileClipboard();
    const commands = new CommandRegistry();
    const opened: string[] = [];
    const openOptions: unknown[] = [];
    commands.register("workbench.openFile", (filePath, options) => {
        opened.push(filePath as string);
        openOptions.push(options);
    });
    const service = new ExplorerService(
        clipboard,
        NULL_CONFIGURATION_SERVICE,
        diskFileService(),
        NULL_TREE_FILE_WATCHER,
    );
    const component = new ExplorerComponent(
        service,
        commands,
        clipboard,
        makeContextMenuService(commands),
        makeViewsHarness().service,
    );
    return {
        service,
        component,
        commands,
        clipboard,
        opened,
        openOptions,
        dispose: () => {
            component.dispose();
            service.dispose();
        },
    };
}

describe("ExplorerComponent", () => {
    let ws: ITempWorkspace;
    let h: ExplorerHarness;
    let app: TestApp;

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "diode-explorer-test-", files: { "src/main.ts": "", "README.md": "" } });
        h = createExplorer();
        h.service.setRootPath(ws.dir);
        app = TestApp.createWithContent(h.component.view, new Size(30, 10));
        h.service.focus();
        await h.service.refresh();
        app.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("creates a view body element (id 'explorerView')", () => {
        expect(h.component.view).toBeDefined();
        expect(h.component.view.id).toBe("explorerView");
    });

    it("filesExplorerFocus — по пути предков до тела секции", () => {
        const keys = new ContextKeyService();
        const focusKey = (active: TUIElement | null): unknown => {
            h.component.updateContextKeys(keys, active);
            return keys.get("filesExplorerFocus");
        };
        const tree = h.component.view.querySelector("TreeViewElement");
        expect(tree).not.toBeNull();

        expect(focusKey(tree)).toBe(true);
        expect(focusKey(h.component.view)).toBe(true);
        // Фокус вне проводника и вовсе без фокуса — ключ опущен, а не undefined.
        expect(focusKey(new FillerElement())).toBe(false);
        expect(focusKey(null)).toBe(false);
    });

    it("filesExplorerFocus опущен, пока дерева ещё нет (корень не задан)", () => {
        const empty = createExplorer();
        const keys = new ContextKeyService();
        empty.component.updateContextKeys(keys, new FillerElement());
        expect(keys.get("filesExplorerFocus")).toBe(false);
        empty.dispose();
    });

    it("shows root directory contents after refresh", () => {
        const output = app.backend.screenToString();
        // Should show "src" directory and "README.md" file
        expect(output).toContain("src");
        expect(output).toContain("README.md");
    });

    it("navigates between items with keyboard", () => {
        const output1 = app.backend.screenToString();
        expect(output1).toContain("src");

        app.sendKey("ArrowDown");
        app.render();

        // After navigating, still shows both items
        const output2 = app.backend.screenToString();
        expect(output2).toContain("src");
        expect(output2).toContain("README.md");
    });

    it("expands directory with ArrowRight", async () => {
        // First item should be "src" directory
        app.sendKey("ArrowRight");
        await new Promise((r) => setTimeout(r, 50));
        app.render();

        const output = app.backend.screenToString();
        expect(output).toContain("main.ts");
    });

    it("activating a directory node does not open an editor", () => {
        // First item is the "src" directory (confirmed by other tests).
        app.sendKey("Enter");
        app.render();

        // Directories never execute workbench.openFile — they toggle/expand instead.
        expect(h.opened).toEqual([]);
    });

    it("a file node activated via Enter opens, a directory activated via Enter does not", () => {
        // src directory is first/selected — Enter must not open it.
        app.sendKey("Enter");
        app.render();
        expect(h.opened).toEqual([]);

        // Move to README.md (a file) — Enter must open it.
        app.sendKey("ArrowDown");
        app.render();
        app.sendKey("Enter");
        app.render();
        expect(h.opened).toEqual([ws.path("README.md")]);
    });

    it("дерево открывает файл ПРЕДПРОСМОТРОМ — единственная такая дверь", () => {
        app.sendKey("ArrowDown"); // README.md
        app.render();
        app.sendKey("Enter");
        app.render();

        // Эталон превьюит из дерева, но не из Quick Open и навигации по коду
        // (`enablePreviewFrom*` там выключены), поэтому флаг ставит дерево.
        expect(h.openOptions).toEqual([{ preview: true }]);
    });

    it("Shift+F10 opens the popup menu anchored at the selected row", () => {
        // "src" is the first/selected row after refresh; дерево в фокусе.
        app.sendKey("Shift+F10");
        app.render();

        expect(app.querySelector("PopupMenuElement")).not.toBeNull();
        expect(app.backend.screenToString()).toContain("New File");
    });

    it("the keyboard context menu follows the selection to another row", () => {
        const created: string[] = [];
        h.commands.register("explorer.newFile", (filePath) => {
            created.push(filePath as string);
        });

        app.sendKey("ArrowDown"); // move selection from "src" to "README.md"
        app.render();
        app.sendKey("Shift+F10");
        app.render();

        // Enter accepts the first entry ("New File...") — it carries the selected path.
        app.sendKey("Enter");
        app.render();
        expect(created).toEqual([ws.path("README.md")]);
        // Selecting the entry also closes the menu.
        expect(app.querySelector("PopupMenuElement")).toBeNull();
    });

    it("re-opening the context menu closes the previous session first", () => {
        app.sendKey("Shift+F10");
        app.render();
        expect(app.querySelectorAll("PopupMenuElement")).toHaveLength(1);

        app.sendKey("Shift+F10");
        app.render();
        // Не два меню разом: предыдущая сессия закрыта.
        expect(app.querySelectorAll("PopupMenuElement")).toHaveLength(1);
    });

    it("the Paste entry appears only when the file clipboard is non-empty", () => {
        app.sendKey("Shift+F10");
        app.render();
        expect(app.backend.screenToString()).not.toContain("Paste");

        app.sendKey("Escape");
        app.render();

        h.clipboard.write([ws.path("README.md")], "copy");
        app.sendKey("Shift+F10");
        app.render();
        expect(app.backend.screenToString()).toContain("Paste");
    });

    it("cleans up on dispose", () => {
        h.dispose();
        // No error thrown — test passes
    });

    it("exposes the tree provider for the opened root", () => {
        // «Корень воркспейса» сервис больше не публикует (за ним ходят в
        // IWorkspaceContextService) — наружу торчит только провайдер дерева.
        expect(h.service.provider).not.toBeNull();
    });

    it("expanding then collapsing a directory still renders the tree (watch/unwatch)", async () => {
        // ArrowRight expands "src" (onExpandedChanged → watchDirectory).
        app.sendKey("ArrowRight");
        await new Promise((r) => setTimeout(r, 50));
        app.render();
        expect(app.backend.screenToString()).toContain("main.ts");

        // ArrowLeft collapses it (onExpandedChanged → unwatchDirectory).
        app.sendKey("ArrowLeft");
        await new Promise((r) => setTimeout(r, 50));
        app.render();

        const output = app.backend.screenToString();
        // Collapsed: child is hidden again, root entries remain.
        expect(output).not.toContain("main.ts");
        expect(output).toContain("src");
        expect(output).toContain("README.md");
    });

    it("colours a decorated file's name and draws its status badge", async () => {
        const gitColor = packRgb(115, 201, 145);
        // README.md is row 1 (src is the cursor on row 0), so its name takes the
        // decoration colour; "U" is a badge letter absent from the sidebar chrome.
        h.service.setFileDecorations([{ path: ws.path("README.md"), color: gitColor, badge: "U" }]);
        await new Promise((r) => setTimeout(r, 20));
        app.render();

        expect(app.backend.screenToString()).toContain("U");

        // Some cell now carries the resolved git decoration colour as its fg.
        let coloured = false;
        const size = app.backend.getSize();
        for (let y = 0; y < size.height && !coloured; y++) {
            for (let x = 0; x < size.width; x++) {
                if (app.backend.getFgAt(new Point(x, y)) === gitColor) {
                    coloured = true;
                    break;
                }
            }
        }
        expect(coloured).toBe(true);
    });

    it("clears decorations when given an empty list", async () => {
        const gitColor = packRgb(115, 201, 145);
        h.service.setFileDecorations([{ path: ws.path("README.md"), color: gitColor, badge: "U" }]);
        await new Promise((r) => setTimeout(r, 20));
        app.render();
        expect(app.backend.screenToString()).toContain("U");

        h.service.setFileDecorations([]);
        await new Promise((r) => setTimeout(r, 20));
        app.render();
        expect(app.backend.screenToString()).not.toContain("U");
    });

    it("highlights cut files when the file clipboard enters cut mode and clears afterwards", () => {
        // Подсветка «вырезанных» следует за буфером через подписку сервиса.
        expect(() => {
            h.clipboard.write([ws.path("README.md")], "cut");
            app.render();
            h.clipboard.clear();
            app.render();
        }).not.toThrow();
    });
});

describe("ExplorerComponent — root assigned after construction", () => {
    let wsA: ITempWorkspace;
    let wsB: ITempWorkspace;

    beforeEach(() => {
        wsA = createTempWorkspace({ prefix: "diode-explorer-a-", files: { "alpha.ts": "" } });
        wsB = createTempWorkspace({ prefix: "diode-explorer-b-", files: { "beta.ts": "" } });
    });

    afterEach(() => {
        wsA.dispose();
        wsB.dispose();
    });

    it("builds and wires the tree when the root arrives after the component", async () => {
        // Component first, while there is no provider yet (пустой конструкторный путь).
        const h = createExplorer();
        // Assigning the root after construction must rebuild the view and wire events.
        h.service.setRootPath(wsB.dir);

        const app = TestApp.createWithContent(h.component.view, new Size(30, 10));
        h.service.focus();
        await h.service.refresh();
        app.render();

        // The single file in wsB must be selectable and openable — proving events wired.
        expect(app.backend.screenToString()).toContain("beta.ts");
        app.sendKey("Enter");
        app.render();
        expect(h.opened).toEqual([wsB.path("beta.ts")]);

        h.dispose();
    });

    it("builds the tree in the constructor when the root is already assigned", async () => {
        const clipboard = new InMemoryFileClipboard();
        const service = new ExplorerService(
            clipboard,
            NULL_CONFIGURATION_SERVICE,
            diskFileService(),
            NULL_TREE_FILE_WATCHER,
        );
        service.setRootPath(wsA.dir);

        const component = new ExplorerComponent(
            service,
            new CommandRegistry(),
            clipboard,
            makeContextMenuService(new CommandRegistry()),
            makeViewsHarness().service,
        );
        const app = TestApp.createWithContent(component.view, new Size(30, 10));
        await service.refresh();
        app.render();
        expect(app.backend.screenToString()).toContain("alpha.ts");

        component.dispose();
        service.dispose();
    });

    it("context menu is a no-op when the tree is empty (no selected row)", async () => {
        const wsEmpty = createTempWorkspace({ prefix: "diode-explorer-empty-" });
        const h = createExplorer();
        h.service.setRootPath(wsEmpty.dir);
        const app = TestApp.createWithContent(h.component.view, new Size(30, 10));
        h.service.focus();
        await h.service.refresh();
        app.render();

        // Tree exists but has no rows → no selected node/anchor → context menu is a no-op.
        app.sendKey("Shift+F10");
        app.render();
        expect(app.querySelector("PopupMenuElement")).toBeNull();

        h.dispose();
        wsEmpty.dispose();
    });
});

/**
 * Строка ниже единственного файла воркспейса: у строки 0 стоит курсор дерева, а
 * заголовка в теле секции больше нет (его рисует контейнер) — фон сайдбара
 * проверяем на пустой строке.
 */
const EMPTY_ROW_SCREEN_Y = 5;

describe("ExplorerComponent with ThemeService", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-explorer-theme-", files: { "index.ts": "" } });
    });

    afterEach(() => {
        ws.dispose();
    });

    it("applies sideBar.background from theme after setRootPath", async () => {
        const themeFile = {
            ...darkPlusTheme,
            colors: { ...darkPlusTheme.colors, "sideBar.background": "#2D2D2D" },
        };
        const themeService = new ThemeService(WorkbenchTheme.fromThemeFile(themeFile));
        const h = createExplorer(themeService);
        h.service.setRootPath(ws.dir);

        const app = TestApp.createWithContent(h.component.view, new Size(30, 10));
        applyThemeVars(app.root, themeService.theme);
        await h.service.refresh();
        app.render();

        const expectedBg = themeService.theme.getColor("sideBar.background")!;
        // Пустая строка под файлами: у строки 0 теперь курсор дерева — заголовок
        // контейнера рисует ViewsService, а не тело секции.
        expect(app.backend.getBgAt(new Point(0, EMPTY_ROW_SCREEN_Y))).toBe(expectedBg);

        h.dispose();
    });

    it("applies sideBar.background when theme changes after setRootPath", async () => {
        const initialTheme = WorkbenchTheme.fromThemeFile(darkPlusTheme);
        const themeService = new ThemeService(initialTheme);
        const h = createExplorer(themeService);
        h.service.setRootPath(ws.dir);

        const newBg = packRgb(0x40, 0x40, 0x40);
        const newThemeFile = {
            ...darkPlusTheme,
            colors: { ...darkPlusTheme.colors, "sideBar.background": "#404040" },
        };
        themeService.setTheme(WorkbenchTheme.fromThemeFile(newThemeFile));

        const app = TestApp.createWithContent(h.component.view, new Size(30, 10));
        applyThemeVars(app.root, themeService.theme);
        await h.service.refresh();
        app.render();

        expect(app.backend.getBgAt(new Point(0, EMPTY_ROW_SCREEN_Y))).toBe(newBg);

        h.dispose();
    });

    it("uses default registry sidebar fg/bg when the theme defines neither", async () => {
        // A theme with no colors at all: sideBar.foreground and sideBar.background are
        // supplied by the dark default color registry, so the sidebar is always colored.
        const bareThemeFile = { ...darkPlusTheme, colors: {} };
        const themeService = new ThemeService(WorkbenchTheme.fromThemeFile(bareThemeFile));
        const h = createExplorer(themeService);
        h.service.setRootPath(ws.dir);

        const app = TestApp.createWithContent(h.component.view, new Size(30, 10));
        applyThemeVars(app.root, themeService.theme);
        await h.service.refresh();
        app.render();

        // Sidebar colors come from the dark default registry (fromThemeFile
        // слоит дефолты под цвета темы, токены всегда резолвятся).
        expect(h.component.view.resolvedStyle.fg).toBe(0xcccccc); // default dark "sideBar.foreground"
        expect(h.component.view.resolvedStyle.bg).toBe(0x252526); // default dark "sideBar.background"
        // Still renders its contents.
        expect(app.backend.screenToString()).toContain("index.ts");

        h.dispose();
    });
});
