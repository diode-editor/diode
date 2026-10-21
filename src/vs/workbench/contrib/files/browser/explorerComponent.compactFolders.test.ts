import * as fs from "node:fs";

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIContextMenuEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
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
import type { ITreeFileWatcher } from "../../../../platform/files/common/iTreeFileWatcher.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { MENU_CONTRIBUTIONS } from "../../../workbench.common.main.ts";

import { ExplorerComponent } from "./explorerComponent.ts";
import { ExplorerService } from "./explorerService.ts";

/** A real tree over a real disk, settings with the app defaults (compaction on). */
describe("ExplorerComponent — explorer.compactFolders", () => {
    let ws: ITempWorkspace;
    let config: InMemoryConfigurationService;
    let clipboard: InMemoryFileClipboard;
    let service: ExplorerService;
    let component: ExplorerComponent;
    let app: TestApp;
    let contextMenuService: ContextMenuService;
    let watched: Set<string>;

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
        watched = new Set();
        // A watcher that only tracks live subscriptions (sends no events).
        const watcher: ITreeFileWatcher = {
            watchTree: (dirPath) => {
                watched.add(dirPath);
                return {
                    dispose: () => {
                        watched.delete(dirPath);
                    },
                };
            },
        };
        service = new ExplorerService(clipboard, config, diskFileService(), watcher);
        const commands = new CommandRegistry();
        contextMenuService = new ContextMenuService(
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

    it("дефолт настройки — true, как у эталона", () => {
        expect(config.get("explorer.compactFolders")).toBe(true);
    });

    it("раскрытая папка с единственным ребёнком-каталогом — одна строка «pkg/a/b» с детьми последней папки", async () => {
        // The chain is unknown until expanded — compaction is lazy, like upstream.
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
        // Intermediate folders get no rows of their own.
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

    it("раскрытая компактная строка следит за каждой своей папкой, свёрнутая — ни за одной", async () => {
        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("pkg/a/b");
        });
        expect([...watched].sort()).toEqual([ws.path("pkg"), ws.path("pkg/a"), ws.path("pkg/a/b")]);

        // Left first walks segments b → a → pkg, and collapses on the first one.
        for (let i = 0; i < 3; i++) app.sendKey("ArrowLeft");
        await vi.waitFor(() => {
            expect(watched.size).toBe(0);
        });
    });

    it("свернул и снова раскрыл — строка остаётся компактной", async () => {
        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("C.java");
        });
        for (let i = 0; i < 3; i++) app.sendKey("ArrowLeft");
        await vi.waitFor(() => {
            expect(rows().join("\n")).not.toContain("C.java");
        });
        expect(rows()[0]).toContain("pkg/a/b");
    });

    it("правый клик по сегменту открывает меню про его папку и делает его текущим", async () => {
        const show = vi.spyOn(contextMenuService, "showContextMenu").mockImplementation(() => {});
        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("pkg/a/b");
        });
        // Row " pkg/a/b": indent 1, chevron, space — "a" is at column 7.
        app.focusedElement?.dispatchEvent(
            new TUIContextMenuEvent({
                trigger: "mouse",
                button: "right",
                screenX: 7,
                screenY: 0,
                localX: 7,
                localY: 0,
            }),
        );
        expect(show.mock.calls.at(-1)?.[0]).toMatchObject({ menuContext: { path: ws.path("pkg/a") } });
        expect(service.getSelectedPaths()).toEqual([ws.path("pkg/a")]);
    });

    it("контекст-ключи explorerViewletCompressed* следуют за текущим сегментом", async () => {
        const keys = new ContextKeyService();
        const update = () => {
            component.updateContextKeys(keys, app.focusedElement);
            return [
                keys.get("explorerViewletCompressedFocus"),
                keys.get("explorerViewletCompressedFirstFocus"),
                keys.get("explorerViewletCompressedLastFocus"),
            ];
        };
        // The chain isn't found yet ("pkg" is collapsed) — a plain row.
        expect(update()).toEqual([false, false, false]);
        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("pkg/a/b");
        });
        expect(update()).toEqual([true, false, true]);
        service.moveCompressedFocus("first");
        expect(update()).toEqual([true, true, false]);
    });

    it("Left/Right выбирают сегмент, действия идут в его папку", async () => {
        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("C.java");
        });
        app.sendKey("ArrowLeft");
        expect(service.getSelectedPaths()).toEqual([ws.path("pkg/a")]);
        expect(service.getPasteTargetDir()).toBe(ws.path("pkg/a"));
        expect(service.getCompressedFocus()).toEqual({ first: false, last: false });
        // The row didn't collapse: Left moved to a segment.
        expect(rows().join("\n")).toContain("C.java");

        app.sendKey("ArrowLeft");
        expect(service.getCompressedFocus()).toEqual({ first: true, last: false });
        app.sendKey("ArrowRight");
        app.sendKey("ArrowRight");
        expect(service.getSelectedPaths()).toEqual([ws.path("pkg/a/b")]);
        expect(service.getCompressedFocus()).toEqual({ first: false, last: true });
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
        // The row itself is selected; its path is the last folder (segments
        // are not selected individually).
        expect(service.getSelectedPaths()).toEqual([ws.path("pkg/a/b")]);
    });

    it("reveal входа, о котором цепочка ещё не знает, выделяет ближайшую компактную строку", async () => {
        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("pkg/a/b");
        });
        app.sendKey("ArrowDown");

        // A file landed in an intermediate folder, and there was no reread yet.
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
        // Expansion survived the rebuild: the row key is the chain head.
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
        // A pattern without a dot: the settings diff doesn't see dotted pattern keys
        // ("**/*.log") yet — see docs/TODO/README.md#настройки.
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
        // The expanded head now shows its direct child.
        expect(frame[1]).toContain("a");
        expect(frame[2]).toContain("README.md");
    });

    it("вырезанная компактная строка подсвечивается по пути последней папки", async () => {
        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(rows().join("\n")).toContain("pkg/a/b");
        });
        // Move the cursor to a file so the selection doesn't override the row color.
        app.sendKey("ArrowDown");
        const labelAt = (): Point => new Point(rows()[0].indexOf("pkg/a/b"), 0);
        const before = app.backend.getFgAt(labelAt());

        // The clipboard gets the node path — the last folder; the row key is the head.
        clipboard.write([ws.path("pkg/a/b")], "cut");
        expect(app.backend.getFgAt(labelAt())).not.toBe(before);

        clipboard.clear();
        expect(app.backend.getFgAt(labelAt())).toBe(before);
    });
});
