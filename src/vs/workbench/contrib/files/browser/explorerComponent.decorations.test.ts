import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
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

const MODIFIED = packRgb(226, 192, 141);
const UNTRACKED = packRgb(115, 201, 145);
const DELETED = packRgb(199, 78, 57);

/**
 * Декорации папок до кадра (VS Code: папка с изменёнными внутри — цвет потомка
 * и бейдж «●»): настоящее дерево Explorer'а над настоящим диском, настройки с
 * дефолтами приложения.
 */
describe("ExplorerComponent — декорации всплывают к папкам", () => {
    let ws: ITempWorkspace;
    let config: InMemoryConfigurationService;
    let service: ExplorerService;
    let component: ExplorerComponent;
    let app: TestApp;

    /** Строки кадра без пустых хвостов. */
    function rows(): string[] {
        app.render();
        return app.backend
            .screenToString()
            .split("\n")
            .map((row) => row.trimEnd())
            .filter((row) => row.trim() !== "");
    }

    /** Строка кадра, содержащая `text` как отдельное слово метки. */
    function rowOf(text: string): { y: number; row: string } {
        const all = rows();
        const y = all.findIndex((row) => new RegExp(`(^|\\s|/)${text}(\\s|$)`).test(row));
        expect(y, `строка «${text}» в кадре:\n${all.join("\n")}`).toBeGreaterThanOrEqual(0);
        return { y, row: all[y] };
    }

    /** Цвет первой буквы метки `text`. */
    function labelFg(text: string): number | undefined {
        const { y, row } = rowOf(text);
        return app.backend.getFgAt(new Point(row.indexOf(text), y));
    }

    /** Бейдж строки — последний непробельный символ (дерево прижимает его к правому краю). */
    function badgeOf(text: string): string {
        const { row } = rowOf(text);
        const tail = row.slice(row.indexOf(text) + text.length).trim();
        return tail;
    }

    async function decorate(entries: Parameters<ExplorerService["setFileDecorations"]>[0]): Promise<void> {
        service.setFileDecorations(entries);
        await service.refresh();
    }

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "diode-explorer-decorations-",
            files: {
                "src/lib/util.ts": "",
                "src/main.ts": "",
                "pkg/a/b/C.java": "",
                "old/keep.ts": "",
                "README.md": "",
            },
        });
        config = createTestConfigurationService();
        const clipboard = new InMemoryFileClipboard();
        service = new ExplorerService(clipboard, config, diskFileService(), NULL_TREE_FILE_WATCHER);
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

    it("дефолты настроек — true, как у эталона", () => {
        expect(config.get("explorer.decorations.colors")).toBe(true);
        expect(config.get("explorer.decorations.badges")).toBe(true);
    });

    it("свёрнутая папка с изменённым файлом глубоко внутри — цвет файла и «●»", async () => {
        await decorate([{ path: ws.path("src/lib/util.ts"), color: MODIFIED, badge: "M", propagate: true }]);

        expect(badgeOf("src")).toBe("●");
        expect(labelFg("src")).toBe(MODIFIED);
        // Соседние папки и файлы — без декораций.
        expect(badgeOf("pkg")).toBe("");
        expect(badgeOf("README.md")).toBe("");

        // Раскрыли: промежуточная папка тоже с «●», сам файл — со своей буквой.
        service.focus();
        // Курсор стоит на первой строке («old»).
        app.sendKey("ArrowDown"); // pkg
        app.sendKey("ArrowDown"); // src
        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("lib");
        });
        app.sendKey("ArrowDown");
        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("util.ts");
        });
        // Строку под курсором красит выделение — цвет смотрим у соседних.
        app.sendKey("ArrowDown"); // util.ts
        expect(badgeOf("lib")).toBe("●");
        expect(labelFg("lib")).toBe(MODIFIED);
        app.sendKey("ArrowDown"); // main.ts
        expect(badgeOf("util.ts")).toBe("M");
        expect(labelFg("util.ts")).toBe(MODIFIED);
    });

    it("файл стал чистым — предки гаснут", async () => {
        await decorate([{ path: ws.path("src/lib/util.ts"), color: MODIFIED, badge: "M", propagate: true }]);
        expect(badgeOf("src")).toBe("●");

        await decorate([]);
        expect(badgeOf("src")).toBe("");
        expect(labelFg("src")).not.toBe(MODIFIED);
    });

    it("из двух изменённых один стал чистым — папка берёт цвет оставшегося", async () => {
        await decorate([
            { path: ws.path("src/main.ts"), color: UNTRACKED, badge: "U", propagate: true },
            { path: ws.path("src/lib/util.ts"), color: MODIFIED, badge: "M", propagate: true },
        ]);
        // «lib» раньше «main.ts» в порядке дерева — цвет от util.ts.
        expect(labelFg("src")).toBe(MODIFIED);

        await decorate([{ path: ws.path("src/main.ts"), color: UNTRACKED, badge: "U", propagate: true }]);
        expect(badgeOf("src")).toBe("●");
        expect(labelFg("src")).toBe(UNTRACKED);
    });

    it("декорация без propagate (удалённый файл) к папке не всплывает", async () => {
        await decorate([{ path: ws.path("old/gone.ts"), color: DELETED, badge: "D", propagate: false }]);
        expect(badgeOf("old")).toBe("");
        expect(labelFg("old")).not.toBe(DELETED);
    });

    it("компактная цепочка «pkg/a/b» несёт декорацию своей последней папки", async () => {
        service.focus();
        app.sendKey("ArrowDown"); // old → pkg
        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("pkg/a/b");
        });

        await decorate([{ path: ws.path("pkg/a/b/C.java"), color: UNTRACKED, badge: "U", propagate: true }]);
        app.sendKey("ArrowDown"); // C.java — курсор с цепочки, чтобы не красило выделение
        expect(badgeOf("pkg/a/b")).toBe("●");
        expect(labelFg("pkg/a/b")).toBe(UNTRACKED);
    });

    it("explorer.decorations.badges=false гасит бейджи, цвет остаётся; настройка живая", async () => {
        await decorate([
            { path: ws.path("src/lib/util.ts"), color: MODIFIED, badge: "M", propagate: true },
            { path: ws.path("README.md"), color: UNTRACKED, badge: "U" },
        ]);
        await config.updateValue("explorer.decorations.badges", false);
        await service.refresh();
        expect(badgeOf("src")).toBe("");
        expect(badgeOf("README.md")).toBe("");
        expect(labelFg("src")).toBe(MODIFIED);
        expect(labelFg("README.md")).toBe(UNTRACKED);

        await config.updateValue("explorer.decorations.badges", true);
        await service.refresh();
        expect(badgeOf("src")).toBe("●");
    });

    it("explorer.decorations.colors=false гасит цвет, бейджи остаются; настройка живая", async () => {
        await decorate([
            { path: ws.path("src/lib/util.ts"), color: MODIFIED, badge: "M", propagate: true },
            { path: ws.path("README.md"), color: UNTRACKED, badge: "U" },
        ]);
        await config.updateValue("explorer.decorations.colors", false);
        await service.refresh();
        expect(labelFg("src")).not.toBe(MODIFIED);
        expect(labelFg("README.md")).not.toBe(UNTRACKED);
        expect(badgeOf("src")).toBe("●");
        expect(badgeOf("README.md")).toBe("U");

        await config.updateValue("explorer.decorations.colors", true);
        await service.refresh();
        expect(labelFg("src")).toBe(MODIFIED);
    });
});
