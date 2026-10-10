import * as fs from "node:fs";

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

/**
 * `explorer.compactFolders` до кадра: настоящее дерево Explorer'а над
 * настоящим диском, настройки с дефолтами приложения (сжатие включено).
 */
describe("ExplorerComponent — explorer.compactFolders", () => {
    let ws: ITempWorkspace;
    let config: InMemoryConfigurationService;
    let clipboard: InMemoryFileClipboard;
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

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "diode-explorer-compact-",
            files: { "pkg/a/b/C.java": "", "pkg/a/b/D.java": "", "README.md": "" },
        });
        config = createTestConfigurationService();
        clipboard = new InMemoryFileClipboard();
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

    it("дефолт настройки — true, как у эталона", () => {
        expect(config.get("explorer.compactFolders")).toBe(true);
    });

    it("раскрытая папка с единственным ребёнком-каталогом — одна строка «pkg/a/b» с детьми последней папки", async () => {
        // До раскрытия цепочка не известна — как у эталона, сжатие ленивое.
        const initial = rows();
        expect(initial).toHaveLength(2);
        expect(initial[0]).toMatch(/pkg$/);
        expect(initial[1]).toContain("README.md");

        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("pkg/a/b");
        });
        const frame = rows();
        expect(frame[0]).toContain("pkg/a/b");
        expect(frame[1]).toContain("C.java");
        expect(frame[2]).toContain("D.java");
        expect(frame[3]).toContain("README.md");
        // Промежуточные папки отдельными строками не показываются.
        expect(frame).toHaveLength(4);
    });

    it("действия над компактной строкой бьют в последнюю папку цепочки", async () => {
        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("pkg/a/b");
        });

        const last = ws.path("pkg/a/b");
        expect(service.getSelectedPaths()).toEqual([last]);
        expect(service.getPasteTargetDir()).toBe(last);
    });

    it("свернул и снова раскрыл — строка остаётся компактной", async () => {
        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("C.java");
        });
        app.sendKey("ArrowLeft");
        await vi.waitFor(() => {
            expect(rows().join("\n")).not.toContain("C.java");
        });
        expect(rows()[0]).toContain("pkg/a/b");
    });

    it("reveal файла внутри цепочки раскрывает компактную строку и выделяет файл", async () => {
        const target = ws.path("pkg/a/b/D.java");
        expect(await service.revealPath(target)).toBe(true);

        const frame = rows();
        expect(frame[0]).toContain("pkg/a/b");
        expect(frame[2]).toContain("D.java");
        expect(service.getSelectedPaths()).toEqual([target]);
    });

    it("reveal промежуточной папки выделяет компактную строку", async () => {
        expect(await service.revealPath(ws.path("pkg/a"))).toBe(true);

        expect(rows()[0]).toContain("pkg/a/b");
        // Выделена сама строка; её путь — последняя папка (сегменты по
        // отдельности не выбираются).
        expect(service.getSelectedPaths()).toEqual([ws.path("pkg/a/b")]);
    });

    it("reveal входа, о котором цепочка ещё не знает, выделяет ближайшую компактную строку", async () => {
        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("pkg/a/b");
        });
        app.sendKey("ArrowDown");

        // Файл лёг в промежуточную папку, а перечитывания ещё не было.
        ws.writeFile("pkg/a/x.ts", "");
        expect(await service.revealPath(ws.path("pkg/a/x.ts"))).toBe(true);

        expect(service.getSelectedPaths()).toEqual([ws.path("pkg/a/b")]);
    });

    it("второй вход в промежуточной папке рвёт цепочку на перечитывании", async () => {
        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("pkg/a/b");
        });

        ws.writeFile("pkg/a/x.ts", "");
        await service.refresh();

        const frame = rows();
        expect(frame[0]).toContain("pkg/a");
        expect(frame[0]).not.toContain("pkg/a/b");
        // Раскрытие пережило перестройку: ключ строки — голова цепочки.
        expect(frame[1]).toContain("b");
        expect(frame[2]).toContain("x.ts");
    });

    it("папка, ставшая единственной, удлиняет цепочку на перечитывании", async () => {
        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("pkg/a/b");
        });

        fs.rmSync(ws.path("pkg/a/b/C.java"));
        fs.rmSync(ws.path("pkg/a/b/D.java"));
        fs.mkdirSync(ws.path("pkg/a/b/c"));
        ws.writeFile("pkg/a/b/c/E.java", "");
        await service.refresh();

        const frame = rows();
        expect(frame[0]).toContain("pkg/a/b/c");
        expect(frame[1]).toContain("E.java");
    });

    it("files.exclude решает, единственный ли ребёнок", async () => {
        // Шаблон без точки: ключи-шаблоны с точкой («**/*.log») дифф настроек
        // пока не видит — см. docs/TODO/ParityBacklog.md.
        ws.writeFile("pkg/a/NOTES", "");
        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("NOTES");
        });
        expect(rows()[0]).not.toContain("pkg/a/b");

        await config.updateValue("files.exclude", { "**/NOTES": true });
        await vi.waitFor(() => {
            expect(rows()[0]).toContain("pkg/a/b");
        });
        expect(rows().join("\n")).not.toContain("NOTES");
    });

    it("настройка выключается вживую — папки снова по одной", async () => {
        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("pkg/a/b");
        });

        await config.updateValue("explorer.compactFolders", false);
        await vi.waitFor(() => {
            expect(rows().join("\n")).not.toContain("pkg/a");
        });
        const frame = rows();
        expect(frame[0]).toContain("pkg");
        // Раскрытая голова теперь показывает своего прямого ребёнка.
        expect(frame[1]).toContain("a");
        expect(frame[2]).toContain("README.md");
    });

    it("вырезанная компактная строка подсвечивается по пути последней папки", async () => {
        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("pkg/a/b");
        });
        // Курсор — на файл, чтобы цвет строки не перекрывало выделение.
        app.sendKey("ArrowDown");
        const labelAt = (): Point => new Point(rows()[0].indexOf("pkg/a/b"), 0);
        const before = app.backend.getFgAt(labelAt());

        // Буфер получает путь узла — последнюю папку; ключ строки — голова.
        clipboard.write([ws.path("pkg/a/b")], "cut");
        expect(app.backend.getFgAt(labelAt())).not.toBe(before);

        clipboard.clear();
        expect(app.backend.getFgAt(labelAt())).toBe(before);
    });
});
