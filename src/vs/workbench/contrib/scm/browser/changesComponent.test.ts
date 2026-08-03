import { describe, expect, it, vi } from "vitest";

import { Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../../../../../tuidom/dom/events/tuiKeyboardEvent.ts";
import { TUIContextMenuEvent, TUIMouseEvent } from "../../../../../../tuidom/dom/events/tuiMouseEvent.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IMenu, MenuService } from "../../../../platform/actions/common/menuService.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { SCM_VIEW_MODE_STATE } from "../../../common/stateKeys.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { ChangesComponent } from "./changesComponent.ts";
import { PUBLISH_CHANGES_COMMAND, ScmChangesService } from "./changesService.ts";
import { buildFolderRow, OPEN_FILE_GLYPH } from "./scmChangeRows.ts";

const theme = WorkbenchTheme.fromThemeFile(darkPlusTheme);

// ─── Fakes / helpers ──────────────────────────────────────────────────────────

type FakeMenuEntry = { label: string; onSelect?: () => void } | { type: "separator" };

function fakeMenu(entries: FakeMenuEntry[] = []): { service: MenuService; menu: IMenu } {
    const menu: IMenu = {
        getEntries: vi.fn(() =>
            entries.map((e) => ("type" in e ? { type: "separator" as const } : { type: "item" as const, ...e })),
        ),
        getSubmenus: () => [],
        onDidChange: () => ({ dispose: () => undefined }),
        dispose: () => undefined,
    };
    return { service: { createMenu: () => menu } as unknown as MenuService, menu };
}

/** In-memory стейт: get отдаёт сохранённое или дефолт, store записывает. */
function fakeState(): { service: IStateService; stored: Map<string, unknown> } {
    const stored = new Map<string, unknown>();
    const service: IStateService = {
        get<T>(descriptor: IStateDescriptor<T>): T {
            return stored.has(descriptor.key) ? (stored.get(descriptor.key) as T) : descriptor.default;
        },
        store<T>(descriptor: IStateDescriptor<T>, value: T): void {
            stored.set(descriptor.key, value);
        },
        openWorkspace: () => {},
        flushSync: () => {},
    };
    return { service, stored };
}

interface IHarness {
    component: ChangesComponent;
    commands: CommandRegistry;
    scm: ScmChangesService;
    menu: IMenu;
    themeService: ThemeService;
    executed: [string, unknown[]][];
}

function make(opts: { state?: IStateService; menuEntries?: FakeMenuEntry[] } = {}): IHarness {
    const commands = new CommandRegistry();
    const scm = new ScmChangesService(commands);
    const { service: menuService, menu } = fakeMenu(opts.menuEntries);
    const themeService = new ThemeService(theme);
    // Реестр view здесь не участвует — компонент тестируется standalone.
    const viewsService = { registerView: () => {} } as unknown as ViewsService;
    const component = new ChangesComponent(
        scm,
        commands,
        new ContextMenuService(menuService),
        opts.state ?? NULL_STATE_SERVICE,
        viewsService,
    );

    const executed: [string, unknown[]][] = [];
    commands.register("scm.action.openFile", (...args) => executed.push(["scm.action.openFile", args]));
    commands.register("scm.action.openChanges", (...args) => executed.push(["scm.action.openChanges", args]));

    return { component, commands, scm, menu, themeService, executed };
}

function publish(
    commands: CommandRegistry,
    entries: { rel: string; status?: string; colorId?: string; group?: string }[],
): void {
    commands.execute(
        PUBLISH_CHANGES_COMMAND,
        entries.map((e) => ({
            uri: Uri.file(`/repo/${e.rel}`).toString(),
            status: e.status ?? "M",
            colorId: e.colorId ?? "gitDecoration.modifiedResourceForeground",
            path: e.rel,
            group: e.group ?? "worktree",
        })),
    );
}

function uriOf(rel: string): string {
    return Uri.file(`/repo/${rel}`).toString();
}

/** Id файловой строки по конвенции `scmRow-<group>-<sanitized-path>`. */
function rowIdOf(rel: string, group = "worktree"): string {
    return `scmRow-${group}-${rel.replace(/[^A-Za-z0-9_-]+/g, "-")}`;
}

function frame(h: IHarness, w = 40, ht = 10): string {
    return renderElement(h.component.view, w, ht, { themeVars: true }).screenToString();
}

function pressEnter(h: IHarness): void {
    h.component.list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));
}

describe("ChangesComponent — flat-режим (по умолчанию)", () => {
    it("рисует пути, букву статуса у правого края и глиф Open File", () => {
        const h = make();
        publish(h.commands, [
            { rel: "nested/b.txt" },
            { rel: "a.txt", status: "U", colorId: "gitDecoration.untrackedResourceForeground", group: "untracked" },
        ]);

        const screen = frame(h);
        expect(screen).toContain("a.txt");
        expect(screen).toContain("nested/b.txt");
        // Буква статуса и глиф — в строке файла.
        expect(screen).toContain("U");
        expect(screen).toContain(OPEN_FILE_GLYPH);
        // Заголовки групп: untracked-строка и worktree-строка → две секции + 2 файла.
        expect(screen).toContain("Changes");
        expect(screen).toContain("Untracked Changes");
        expect(h.component.list.rowCount).toBe(4);
    });

    it("пустой набор — пустой список (рамку SOURCE CONTROL рисует контейнер ViewsService)", () => {
        const h = make();
        expect(h.component.list.rowCount).toBe(0);
        expect(frame(h).trim()).toBe("");
    });

    it("Enter по файлу исполняет scm.action.openChanges с uri строкой", () => {
        const h = make();
        publish(h.commands, [{ rel: "a.txt" }]);

        h.component.list.setCursorTo(rowIdOf("a.txt"));
        pressEnter(h);

        expect(h.executed).toEqual([["scm.action.openChanges", [uriOf("a.txt")]]]);
    });

    it("Enter по заголовку группы сворачивает её вместе с файлами", () => {
        const h = make();
        publish(h.commands, [{ rel: "a.txt" }]);

        h.component.list.setCursorTo("scmGroup-worktree");
        pressEnter(h);
        expect(frame(h)).not.toContain("a.txt");

        // Свёрнутость группы переживает повторный publish другого набора.
        publish(h.commands, [{ rel: "a.txt" }, { rel: "b.txt" }]);
        expect(frame(h)).not.toContain("b.txt");
        expect(h.executed).toEqual([]);
    });

    it("клик по глифу исполняет scm.action.openFile, не трогая курсор", () => {
        const h = make();
        publish(h.commands, [{ rel: "a.txt" }, { rel: "b.txt" }]);

        const width = 30;
        TestApp.createWithContent(h.component.view, new Size(width, 10));
        const list = h.component.list;
        // Глиф — во второй колонке справа (fixed 2 перед статусом fixed 1).
        const glyphX = list.globalPosition.x + list.layoutSize.width - 3;
        const rowY = list.globalPosition.y + 2; // третья строка (заголовок группы, a.txt, b.txt)
        list.dispatchEvent(
            new TUIMouseEvent("click", {
                button: "left",
                screenX: glyphX,
                screenY: rowY,
                localX: glyphX - list.globalPosition.x,
                localY: 2,
            }),
        );

        expect(h.executed).toEqual([["scm.action.openFile", [uriOf("b.txt")]]]);
        expect(list.getCursorElement()?.id).toBe("scmGroup-worktree");
    });

    it("getCursorChange отдаёт изменение под курсором, а на пустом списке — null", () => {
        const h = make();
        expect(h.component.getCursorChange()).toBeNull();

        publish(h.commands, [{ rel: "a.txt" }]);
        h.component.list.setCursorTo(rowIdOf("a.txt"));
        expect(h.component.getCursorChange()?.path).toBe("a.txt");

        h.component.list.setCursorTo("scmGroup-worktree");
        expect(h.component.getCursorChange()).toBeNull();
    });

    it("курсор переживает publish, если строка осталась в наборе", () => {
        const h = make();
        publish(h.commands, [{ rel: "a.txt" }, { rel: "b.txt" }]);
        h.component.list.setCursorTo(rowIdOf("b.txt"));

        publish(h.commands, [{ rel: "a.txt" }, { rel: "b.txt" }, { rel: "c.txt" }]);

        expect(h.component.list.getCursorElement()?.id).toBe(rowIdOf("b.txt"));
    });

    it("файл в двух группах (MM) — две строки с разными id", () => {
        const h = make();
        publish(h.commands, [
            { rel: "a.txt", group: "index", status: "M" },
            { rel: "a.txt", group: "worktree", status: "M" },
        ]);

        const screen = frame(h);
        expect(screen).toContain("Staged Changes");
        expect(screen).toContain("Changes");
        expect(h.component.list.rowCount).toBe(4);

        h.component.list.setCursorTo(rowIdOf("a.txt", "index"));
        expect(h.component.getCursorChange()?.group).toBe("index");
        h.component.list.setCursorTo(rowIdOf("a.txt", "worktree"));
        expect(h.component.getCursorChange()?.group).toBe("worktree");
    });

    it("коллизия санитизации id (a.b ↔ a-b ↔ a_b-двойник) разводится суффиксом", () => {
        const h = make();
        publish(h.commands, [{ rel: "a.b" }, { rel: "a-b" }, { rel: "a?b" }]);

        // Все три строки живы, id уникальны.
        expect(h.component.list.rowCount).toBe(4);
        h.component.list.setCursorTo("scmRow-worktree-a-b");
        expect(h.component.getCursorChange()).not.toBeNull();
        h.component.list.setCursorTo("scmRow-worktree-a-b_2");
        expect(h.component.getCursorChange()).not.toBeNull();
        h.component.list.setCursorTo("scmRow-worktree-a-b_3");
        expect(h.component.getCursorChange()).not.toBeNull();
    });

    it("конфликтный файл попадает в группу Merge Changes первой секцией", () => {
        const h = make();
        publish(h.commands, [
            { rel: "a.txt" },
            { rel: "conflict.txt", group: "merge", status: "U", colorId: "gitDecoration.conflictingResourceForeground" },
        ]);

        const screen = frame(h);
        expect(screen).toContain("Merge Changes");
        // Merge-секция выше worktree-секции.
        expect(screen.indexOf("Merge Changes")).toBeLessThan(screen.indexOf("conflict.txt"));
        expect(screen.indexOf("conflict.txt")).toBeLessThan(screen.indexOf("a.txt"));
    });
});

describe("ChangesComponent — tree-режим", () => {
    it("setViewMode('tree') группирует по папкам с компакцией и collapse работает", () => {
        const h = make();
        // src/vs — компакт-цепочка; src/vs/sub рядом с файлами ломает компакцию
        // ниже и гоняет рекурсивный сбор файлов папки (rowMeta папки src/vs).
        publish(h.commands, [
            { rel: "src/vs/a.ts" },
            { rel: "src/vs/b.ts" },
            { rel: "src/vs/sub/c.ts" },
            { rel: "root.txt" },
        ]);

        h.component.setViewMode("tree");
        let screen = frame(h);
        expect(screen).toContain("src/vs"); // компакт-цепочка одним узлом
        expect(screen).toContain("a.ts");
        expect(screen).not.toContain("src/vs/a.ts");

        // Активация папки сворачивает её вместе с детьми.
        h.component.list.setCursorTo("scmDir-worktree-src-vs");
        pressEnter(h);
        screen = frame(h);
        expect(screen).not.toContain("a.ts");
        expect(h.executed).toEqual([]); // папка не открывает дифф

        expect(h.component.getCursorChange()).toBeNull(); // курсор на папке — не файл
    });

    it("setViewMode пишет в стор, restoreViewMode читает без записи", () => {
        const { service, stored } = fakeState();
        const h = make({ state: service });
        expect(h.component.getViewMode()).toBe("flat");

        h.component.setViewMode("tree");
        expect(stored.get(SCM_VIEW_MODE_STATE.key)).toBe("tree");
        h.component.setViewMode("tree"); // повтор — no-op

        stored.set(SCM_VIEW_MODE_STATE.key, "flat");
        const writes = vi.spyOn(service, "store");
        h.component.restoreViewMode();
        expect(h.component.getViewMode()).toBe("flat");
        expect(writes).not.toHaveBeenCalled();

        h.component.restoreViewMode(); // повтор — no-op
        expect(h.component.getViewMode()).toBe("flat");
    });

    it("переключение режимов пересобирает строки из снимка без нового publish", () => {
        const h = make();
        publish(h.commands, [{ rel: "nested/b.txt" }]);

        h.component.setViewMode("tree");
        expect(frame(h)).not.toContain("nested/b.txt");
        h.component.setViewMode("flat");
        expect(frame(h)).toContain("nested/b.txt");
    });
});

describe("ChangesComponent — тема и контекстное меню", () => {
    it("смена темы перекрашивает строки на месте, без пересборки (в т.ч. папки дерева)", () => {
        const h = make();
        publish(h.commands, [{ rel: "nested/a.txt" }]);
        h.component.setViewMode("tree"); // папочная строка проходит рестайл нетронутой
        const rowBefore = h.component.list.getChildren()[0];
        const before = frame(h);

        h.themeService.setTheme(theme); // повторное применение гоняет рестайл по строкам

        expect(frame(h)).toBe(before);
        expect(h.component.list.getChildren()[0]).toBe(rowBefore); // те же элементы
    });

    it("активация и контекст-меню строки с неизвестным id — тихий no-op (защита моста rowMeta)", () => {
        const h = make();
        publish(h.commands, [{ rel: "a.txt" }]);

        const ghost = buildFolderRow("ghost", "ghost");
        expect(() => h.component.list.onActivate?.(ghost)).not.toThrow();
        expect(() => h.component.list.onContextMenu?.(ghost, 0, 0)).not.toThrow();
        expect(h.executed).toEqual([]);
    });

    it("getSelectedChanges: курсор на заголовке группы — пустой список целей", () => {
        const h = make();
        publish(h.commands, [{ rel: "a.txt" }]);

        h.component.list.setCursorTo("scmGroup-worktree");
        expect(h.component.getSelectedChanges()).toEqual([]);
    });

    it("правый клик по файлу открывает контекстное меню, Enter выбирает, Escape закрывает", () => {
        const onSelect = vi.fn();
        // Сепаратор — проверка, что он проходит обёртку onSelect без изменений.
        const h = make({ menuEntries: [{ label: "Open File", onSelect }, { type: "separator" }] });
        publish(h.commands, [{ rel: "a.txt" }]);

        const app = TestApp.createWithContent(h.component.view, new Size(40, 12));

        const list = h.component.list;
        // Строка 0 — заголовок группы, файл a.txt — строка 1.
        const rightClick = () => {
            list.dispatchEvent(
                new TUIContextMenuEvent({
                    trigger: "mouse",
                    button: "right",
                    screenX: list.globalPosition.x + 2,
                    screenY: list.globalPosition.y + 1,
                    localX: 2,
                    localY: 1,
                }),
            );
            app.render();
        };

        rightClick();
        expect(h.menu.getEntries).toHaveBeenCalledWith(
            { kind: "resource", uris: [uriOf("a.txt")], groups: ["worktree"] },
            expect.any(Function),
        );
        expect(app.backend.screenToString()).toContain("Open File");

        // Повторный вызов закрывает прежнюю сессию и открывает новую.
        rightClick();
        expect(app.backend.screenToString()).toContain("Open File");

        // Enter выбирает пункт: сессия закрывается ДО original onSelect.
        app.querySelector("PopupMenuElement")!.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
        app.render();
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(app.backend.screenToString()).not.toContain("Open File");

        // Escape закрывает через menu.onClose → session.close() (гард onClose).
        rightClick();
        app.querySelector("PopupMenuElement")!.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));
        app.render();
        expect(app.backend.screenToString()).not.toContain("Open File");
    });

    it("вне приложения правый клик — тихий no-op (нет overlay-слоя)", () => {
        const h = make({ menuEntries: [{ label: "Open File" }] });
        publish(h.commands, [{ rel: "nested/b.txt" }]);

        const list = h.component.list;
        expect(() =>
            list.dispatchEvent(
                new TUIContextMenuEvent({
                    trigger: "mouse",
                    button: "right",
                    screenX: 2,
                    screenY: 1,
                    localX: 2,
                    localY: 1,
                }),
            ),
        ).not.toThrow();
    });

    it("меню на папке несёт файлы поддерева, на заголовке группы — всю группу", () => {
        const h = make({ menuEntries: [{ label: "Stage Changes" }] });
        publish(h.commands, [{ rel: "nested/a.txt" }, { rel: "nested/b.txt" }, { rel: "root.txt" }]);
        h.component.setViewMode("tree");
        const app = TestApp.createWithContent(h.component.view, new Size(40, 12));
        const list = h.component.list;
        const rightClickRow = (row: number) => {
            list.dispatchEvent(
                new TUIContextMenuEvent({
                    trigger: "mouse",
                    button: "right",
                    screenX: list.globalPosition.x + 2,
                    screenY: list.globalPosition.y + row,
                    localX: 2,
                    localY: row,
                }),
            );
            app.render();
        };

        // Строки: заголовок Changes (0), папка nested (1), a.txt (2), b.txt (3), root.txt (4).
        rightClickRow(1);
        expect(h.menu.getEntries).toHaveBeenLastCalledWith(
            { kind: "folder", uris: [uriOf("nested/a.txt"), uriOf("nested/b.txt")], groups: ["worktree"] },
            expect.any(Function),
        );

        rightClickRow(0);
        expect(h.menu.getEntries).toHaveBeenLastCalledWith(
            {
                kind: "group",
                uris: [uriOf("nested/a.txt"), uriOf("nested/b.txt"), uriOf("root.txt")],
                groups: ["worktree"],
            },
            expect.any(Function),
        );
    });

    it("правый клик по строке из multi-select несёт всё выделение, вне его — одну строку", () => {
        const h = make({ menuEntries: [{ label: "Stage Changes" }] });
        publish(h.commands, [{ rel: "a.txt" }, { rel: "b.txt" }, { rel: "c.txt" }]);
        const app = TestApp.createWithContent(h.component.view, new Size(40, 12));
        const list = h.component.list;

        // Выделяем a.txt и b.txt (строки 1–2): курсор на a.txt, Shift+Down.
        list.setCursorTo(rowIdOf("a.txt"));
        list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "ArrowDown", shiftKey: true }));
        const rightClickRow = (row: number) => {
            list.dispatchEvent(
                new TUIContextMenuEvent({
                    trigger: "mouse",
                    button: "right",
                    screenX: list.globalPosition.x + 2,
                    screenY: list.globalPosition.y + row,
                    localX: 2,
                    localY: row,
                }),
            );
            app.render();
        };

        // Клик по b.txt (в выделении) — контекст из обеих строк.
        rightClickRow(2);
        expect(h.menu.getEntries).toHaveBeenLastCalledWith(
            { kind: "resource", uris: [uriOf("a.txt"), uriOf("b.txt")], groups: ["worktree"] },
            expect.any(Function),
        );
        expect(h.component.getSelectedChanges().map((c) => c.path)).toEqual(["a.txt", "b.txt"]);

        // Клик по c.txt (вне выделения) — контекст из одной строки.
        rightClickRow(3);
        expect(h.menu.getEntries).toHaveBeenLastCalledWith(
            { kind: "resource", uris: [uriOf("c.txt")], groups: ["worktree"] },
            expect.any(Function),
        );

        // Прямой вызов колбэка по строке вне текущего выделения (движок так шлёт
        // keyboard-trigger) — контекст из этой строки, не из выделения.
        h.component.list.setCursorTo(rowIdOf("a.txt"));
        const rowA = h.component.list.getCursorElement()!;
        h.component.list.setCursorTo(rowIdOf("b.txt"));
        h.component.list.onContextMenu?.(rowA, 5, 5);
        app.render();
        expect(h.menu.getEntries).toHaveBeenLastCalledWith(
            { kind: "resource", uris: [uriOf("a.txt")], groups: ["worktree"] },
            expect.any(Function),
        );
    });
});
