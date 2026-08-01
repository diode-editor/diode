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
    const component = new ChangesComponent(
        scm,
        commands,
        new ContextMenuService(menuService),
        opts.state ?? NULL_STATE_SERVICE,
        themeService,
    );

    const executed: [string, unknown[]][] = [];
    commands.register("scm.action.openFile", (...args) => executed.push(["scm.action.openFile", args]));
    commands.register("scm.action.openChanges", (...args) => executed.push(["scm.action.openChanges", args]));

    return { component, commands, scm, menu, themeService, executed };
}

function publish(commands: CommandRegistry, entries: { rel: string; status?: string; colorId?: string }[]): void {
    commands.execute(
        PUBLISH_CHANGES_COMMAND,
        entries.map((e) => ({
            uri: Uri.file(`/repo/${e.rel}`).toString(),
            status: e.status ?? "M",
            colorId: e.colorId ?? "gitDecoration.modifiedResourceForeground",
            path: e.rel,
        })),
    );
}

function uriOf(rel: string): string {
    return Uri.file(`/repo/${rel}`).toString();
}

function frame(h: IHarness, w = 40, ht = 10): string {
    return renderElement(h.component.view, w, ht, { resolveStyles: true }).screenToString();
}

function pressEnter(h: IHarness): void {
    h.component.list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));
}

describe("ChangesComponent — flat-режим (по умолчанию)", () => {
    it("рисует пути, букву статуса у правого края и глиф Open File", () => {
        const h = make();
        publish(h.commands, [
            { rel: "nested/b.txt" },
            { rel: "a.txt", status: "U", colorId: "gitDecoration.untrackedResourceForeground" },
        ]);

        const screen = frame(h);
        expect(screen).toContain("a.txt");
        expect(screen).toContain("nested/b.txt");
        // Буква статуса и глиф — в строке файла.
        expect(screen).toContain("U");
        expect(screen).toContain(OPEN_FILE_GLYPH);
        expect(h.component.list.rowCount).toBe(2);
    });

    it("пустой набор — пустой список под рамкой", () => {
        const h = make();
        expect(h.component.list.rowCount).toBe(0);
        expect(frame(h)).toContain("SOURCE CONTROL");
    });

    it("Enter по файлу исполняет scm.action.openChanges с uri строкой", () => {
        const h = make();
        publish(h.commands, [{ rel: "a.txt" }]);

        h.component.list.setCursorTo(uriOf("a.txt"));
        pressEnter(h);

        expect(h.executed).toEqual([["scm.action.openChanges", [uriOf("a.txt")]]]);
    });

    it("клик по глифу исполняет scm.action.openFile, не трогая курсор", () => {
        const h = make();
        publish(h.commands, [{ rel: "a.txt" }, { rel: "b.txt" }]);

        const width = 30;
        TestApp.createWithContent(h.component.view, new Size(width, 10));
        const list = h.component.list;
        // Глиф — во второй колонке справа (fixed 2 перед статусом fixed 1).
        const glyphX = list.globalPosition.x + list.layoutSize.width - 3;
        const rowY = list.globalPosition.y + 1; // вторая строка (b.txt)
        list.dispatchEvent(
            new TUIMouseEvent("click", {
                button: "left",
                screenX: glyphX,
                screenY: rowY,
                localX: glyphX - list.globalPosition.x,
                localY: 1,
            }),
        );

        expect(h.executed).toEqual([["scm.action.openFile", [uriOf("b.txt")]]]);
        expect(list.getCursorElement()?.id).toBe(uriOf("a.txt"));
    });

    it("getCursorChange отдаёт изменение под курсором, а на пустом списке — null", () => {
        const h = make();
        expect(h.component.getCursorChange()).toBeNull();

        publish(h.commands, [{ rel: "a.txt" }]);
        h.component.list.setCursorTo(uriOf("a.txt"));
        expect(h.component.getCursorChange()?.path).toBe("a.txt");
    });

    it("курсор переживает publish, если строка осталась в наборе", () => {
        const h = make();
        publish(h.commands, [{ rel: "a.txt" }, { rel: "b.txt" }]);
        h.component.list.setCursorTo(uriOf("b.txt"));

        publish(h.commands, [{ rel: "a.txt" }, { rel: "b.txt" }, { rel: "c.txt" }]);

        expect(h.component.list.getCursorElement()?.id).toBe(uriOf("b.txt"));
    });
});

describe("ChangesComponent — tree-режим", () => {
    it("setViewMode('tree') группирует по папкам с компакцией и collapse работает", () => {
        const h = make();
        publish(h.commands, [{ rel: "src/vs/a.ts" }, { rel: "src/vs/b.ts" }, { rel: "root.txt" }]);

        h.component.setViewMode("tree");
        let screen = frame(h);
        expect(screen).toContain("src/vs"); // компакт-цепочка одним узлом
        expect(screen).toContain("a.ts");
        expect(screen).not.toContain("src/vs/a.ts");

        // Активация папки сворачивает её вместе с детьми.
        h.component.list.setCursorTo("dir:src/vs");
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

    it("активация строки с неизвестным id — тихий no-op (защита моста rowMeta)", () => {
        const h = make();
        publish(h.commands, [{ rel: "a.txt" }]);

        const ghost = buildFolderRow("ghost", "ghost");
        expect(() => h.component.list.onActivate?.(ghost)).not.toThrow();
        expect(h.executed).toEqual([]);
    });

    it("правый клик по файлу открывает контекстное меню, Enter выбирает, Escape закрывает", () => {
        const onSelect = vi.fn();
        // Сепаратор — проверка, что он проходит обёртку onSelect без изменений.
        const h = make({ menuEntries: [{ label: "Open File", onSelect }, { type: "separator" }] });
        publish(h.commands, [{ rel: "a.txt" }]);

        const app = TestApp.createWithContent(h.component.view, new Size(40, 12));

        const list = h.component.list;
        const rightClick = () => {
            list.dispatchEvent(
                new TUIContextMenuEvent({
                    trigger: "mouse",
                    button: "right",
                    screenX: list.globalPosition.x + 2,
                    screenY: list.globalPosition.y,
                    localX: 2,
                    localY: 0,
                }),
            );
            app.render();
        };

        rightClick();
        expect(h.menu.getEntries).toHaveBeenCalledWith({ uri: uriOf("a.txt") }, expect.any(Function));
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

    it("вне приложения и на папках правый клик — тихий no-op", () => {
        const h = make({ menuEntries: [{ label: "Open File" }] });
        publish(h.commands, [{ rel: "nested/b.txt" }]);

        // Вне приложения (нет overlay-слоя): файловая строка не роняет.
        const list = h.component.list;
        list.dispatchEvent(
            new TUIContextMenuEvent({
                trigger: "mouse",
                button: "right",
                screenX: 2,
                screenY: 0,
                localX: 2,
                localY: 0,
            }),
        );

        // Папка в tree-режиме: меню не собирается вовсе (guard до сервиса).
        h.component.setViewMode("tree");
        const app = TestApp.createWithContent(h.component.view, new Size(40, 12));
        (h.menu.getEntries as ReturnType<typeof vi.fn>).mockClear();
        list.dispatchEvent(
            new TUIContextMenuEvent({
                trigger: "mouse",
                button: "right",
                screenX: list.globalPosition.x + 2,
                screenY: list.globalPosition.y,
                localX: 2,
                localY: 0,
            }),
        );
        app.render();
        expect(h.menu.getEntries).not.toHaveBeenCalled();
        expect(app.querySelector("PopupMenuElement")).toBeNull();
    });
});
