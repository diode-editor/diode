import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Point, Size } from "@tuidom/all/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/all/dom/events/tuiMouseEvent";
import { BodyElement } from "@tuidom/all/ui/body/bodyElement";
import type { InputElement } from "@tuidom/all/ui/inputbox/inputElement";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { createSelection } from "../../../../editor/common/core/iSelection.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { EditorGroupComponent } from "../../../browser/parts/editor/editorGroupComponent.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { EditorService } from "../../../services/editor/browser/editorService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { FindComponent, type FindWidget } from "./findComponent.ts";
import { FindService } from "./findService.ts";

function makeGroup(): {
    group: EditorService;
    groupComponent: EditorGroupComponent;
    themeService: ThemeService;
} {
    const themeService = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    const group = new EditorService(
        themeService,
        new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        NULL_LANGUAGE_SERVICE,
        NULL_CONFIGURATION_SERVICE,
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
        NULL_LOG_SERVICE,
    );
    const groupComponent = new EditorGroupComponent(group.activeGroup, group);
    return { group, groupComponent, themeService };
}

/** Simulates typing into the find input (drives the onChange → recompute chain). */
function typeQuery(widget: FindWidget, query: string): void {
    const input = widget.view.querySelector("InputElement") as InputElement;
    input.inputState.value = query;
    input.onChange?.(query);
}

describe("FindService", () => {
    let tmpDir: string;
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "vexx-find-" });
        tmpDir = ws.dir;
    });

    afterEach(() => {
        ws.dispose();
    });

    function setup(text: string): {
        find: FindService;
        component: FindComponent;
        widget: FindWidget;
        group: EditorService;
        groupComponent: EditorGroupComponent;
        editor: TextEditorPane;
        testApp: TestApp;
    } {
        const filePath = path.join(tmpDir, "file.txt");
        fs.writeFileSync(filePath, text);
        const { group, groupComponent, themeService } = makeGroup();
        group.openFile(filePath);

        const body = new BodyElement();
        body.setContent(groupComponent.view);
        const testApp = TestApp.create(body, new Size(80, 24));
        testApp.render();

        const component = new FindComponent();
        component.hostProvider = () => groupComponent.view;
        const find = new FindService(component, group);
        // Виджет единственной группы (создаётся лениво — здесь явно, для ассертов).
        const widget = component.widgetFor(group.activeGroup.id)!;

        // getActiveEditor() is non-null right after openFile.
        const editor = group.getActiveEditor()!;
        return { find, component, widget, group, groupComponent, editor, testApp };
    }

    it("open() shows the widget and close() hides it", () => {
        const { find } = setup("foo bar foo");
        expect(find.isVisible()).toBe(false);
        find.open();
        expect(find.isVisible()).toBe(true);
        find.close();
        expect(find.isVisible()).toBe(false);
    });

    it("повторная активация той же вкладки не закрывает сессию поиска", () => {
        const { find, group } = setup("foo bar foo");
        find.open();
        expect(find.isVisible()).toBe(true);

        // activateTab файрит onDidChangeActivePane безусловно; цель сессии не
        // изменилась — find обязан пережить событие.
        group.activeGroup.activateTab(0);

        expect(find.isVisible()).toBe(true);
    });

    it("an outside pointer press does NOT close the widget", () => {
        // Unlike QuickPick, the find widget is non-modal and stays open when the
        // user clicks into the editor (so they can keep navigating matches).
        const { find, testApp } = setup("foo bar foo");
        find.open();
        expect(find.isVisible()).toBe(true);

        testApp.root.dispatchEvent(
            new TUIMouseEvent("mousedown", {
                screenX: 0,
                screenY: 0,
                localX: 0,
                localY: 0,
                button: "left",
            }),
        );

        expect(find.isVisible()).toBe(true);
    });

    it("typing seeds match highlights on the editor", () => {
        const { find, widget, editor } = setup("foo bar foo");
        find.open();
        typeQuery(widget, "foo");
        expect(editor.viewState.searchMatches).toHaveLength(2);
        expect(editor.viewState.currentSearchMatchIndex).toBe(0);
    });

    it("next() and prev() cycle through matches with wrap-around", () => {
        const { find, widget, editor } = setup("foo bar foo");
        find.open();
        typeQuery(widget, "foo");
        expect(editor.viewState.currentSearchMatchIndex).toBe(0);
        find.next();
        expect(editor.viewState.currentSearchMatchIndex).toBe(1);
        find.next(); // wraps
        expect(editor.viewState.currentSearchMatchIndex).toBe(0);
        find.prev(); // wraps backwards
        expect(editor.viewState.currentSearchMatchIndex).toBe(1);
    });

    // F3 в VS Code живёт от фокуса в редакторе (`EditorContextKeys.focus`), а не от
    // видимости виджета: закрыли поиск — навигация по последнему запросу продолжается.
    describe("навигация с закрытым виджетом", () => {
        it("next() ищет по последнему запросу и не показывает виджет", () => {
            const { find, widget, editor } = setup("foo bar foo baz foo");
            find.open();
            typeQuery(widget, "foo");
            find.close();
            editor.viewState.selections = [createSelection(0, 0, 0, 0)];

            find.next();

            expect(find.isVisible()).toBe(false);
            // Первое нажатие приводит на ближайшее совпадение от курсора…
            expect(editor.viewState.currentSearchMatchIndex).toBe(0);
            expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 3 });

            // …дальнейшие шагают дальше и тянут курсор за собой.
            find.next();
            expect(editor.viewState.currentSearchMatchIndex).toBe(1);
            expect(editor.viewState.selections[0].anchor).toEqual({ line: 0, character: 8 });
        });

        it("prev() с закрытым виджетом идёт назад с заворотом", () => {
            const { find, widget, editor } = setup("foo bar foo baz foo");
            find.open();
            typeQuery(widget, "foo");
            find.close();
            editor.viewState.selections = [createSelection(0, 0, 0, 0)];

            find.prev();

            expect(find.isVisible()).toBe(false);
            expect(editor.viewState.currentSearchMatchIndex).toBe(2);
        });

        it("пустой запрос сеется из выделения — виджет по-прежнему не нужен", () => {
            const { find, widget, editor } = setup("foo bar foo");
            editor.viewState.selections = [createSelection(0, 4, 0, 7)]; // "bar"

            find.next();

            expect(widget.getQuery()).toBe("bar");
            expect(find.isVisible()).toBe(false);
            expect(editor.viewState.searchMatches).toHaveLength(1);
        });

        it("запрос без совпадений — тихий no-op, виджет не всплывает", () => {
            const { find, widget, editor } = setup("foo bar foo");
            find.open();
            typeQuery(widget, "zzz");
            find.close();
            editor.viewState.selections = [createSelection(0, 0, 0, 0)];

            find.next();

            expect(find.isVisible()).toBe(false);
            expect(editor.viewState.searchMatches).toEqual([]);
            expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 0 });
        });

        it("без запроса и без выделения открывает виджет — искать нечего", () => {
            const { find, editor } = setup("foo bar foo");
            editor.viewState.selections = [createSelection(0, 0, 0, 0)];

            find.next();

            expect(find.isVisible()).toBe(true);
        });
    });

    it("right-aligns the widget one column shy of the group's edge", () => {
        const { find, groupComponent, testApp } = setup("foo bar foo");
        find.open();
        testApp.render();

        const groupWidth = groupComponent.view.layoutSize.width;
        const widgetW = Math.min(60, Math.max(28, groupWidth - 2));
        const borderRow = 1; // directly under the tab strip

        const charAt = (x: number): string => testApp.backend.getTextAt(new Point(x, borderRow), 1);

        // 1-col margin: the group's last column stays empty, the corner sits just inside it.
        expect(charAt(groupWidth - 1)).toBe(" ");
        expect(charAt(groupWidth - 2)).toBe("╮");
        // Top-left corner lands exactly widgetW columns to the left of the corner.
        expect(charAt(groupWidth - 1 - widgetW)).toBe("╭");
    });

    it("seeds the query from a single-line selection on open", () => {
        const { find, widget, editor } = setup("foo bar foo");
        editor.viewState.selections = [createSelection(0, 0, 0, 3)]; // selects "foo"
        find.open();
        expect(widget.getQuery()).toBe("foo");
        expect(editor.viewState.searchMatches).toHaveLength(2);
    });

    it("close() clears highlights and moves the cursor to the current match", () => {
        const { find, widget, editor } = setup("foo bar foo");
        find.open();
        typeQuery(widget, "foo");
        find.next(); // current = match at char 8
        find.close();

        expect(editor.viewState.searchMatches).toEqual([]);
        expect(editor.viewState.currentSearchMatchIndex).toBe(-1);
        const sel = editor.viewState.selections[0];
        expect(sel.anchor).toEqual({ line: 0, character: 8 });
        expect(sel.active).toEqual({ line: 0, character: 11 });
    });

    it("next() is a no-op when there are no matches", () => {
        const { find, widget, editor } = setup("foo bar foo");
        find.open();
        typeQuery(widget, "zzz");
        expect(editor.viewState.searchMatches).toEqual([]);
        expect(() => {
            find.next();
        }).not.toThrow();
        expect(editor.viewState.currentSearchMatchIndex).toBe(-1);
    });

    it("open() on an already-open widget just refocuses without re-seeding", () => {
        const { find, widget, editor } = setup("foo bar foo");
        find.open();
        typeQuery(widget, "foo");
        find.next(); // current = second match
        expect(editor.viewState.currentSearchMatchIndex).toBe(1);

        find.open(); // already open — must not reset the query or the current match
        expect(find.isVisible()).toBe(true);
        expect(widget.getQuery()).toBe("foo");
        expect(editor.viewState.currentSearchMatchIndex).toBe(1);
    });

    it("wraps the current match to the first when the cursor sits past every match", () => {
        const { find, editor, widget } = setup("foo bar foo");
        // Collapsed cursor at end of line — after both matches.
        editor.viewState.selections = [createSelection(0, 11, 0, 11)];
        find.open();
        typeQuery(widget, "foo");
        expect(editor.viewState.currentSearchMatchIndex).toBe(0);
    });

    it("prev() is a no-op when there are no matches", () => {
        const { find, widget, editor } = setup("foo bar foo");
        find.open();
        typeQuery(widget, "zzz");
        expect(() => {
            find.prev();
        }).not.toThrow();
        expect(editor.viewState.currentSearchMatchIndex).toBe(-1);
    });

    it("wires the widget callbacks to next / prev / close", () => {
        const { find, widget, editor } = setup("foo bar foo");
        find.open();
        typeQuery(widget, "foo");

        widget.onNext?.();
        expect(editor.viewState.currentSearchMatchIndex).toBe(1);
        widget.onPrev?.();
        expect(editor.viewState.currentSearchMatchIndex).toBe(0);
        widget.onClose?.();
        expect(find.isVisible()).toBe(false);
    });

    it("disposing the component tears down the overlay session", () => {
        const { find, component } = setup("foo bar foo");
        find.open();
        expect(find.isVisible()).toBe(true);
        component.dispose();
        expect(find.isVisible()).toBe(false);
    });

    it("switching the active editor closes the widget", () => {
        const { find, group, testApp } = setup("foo bar foo");
        find.open();
        expect(find.isVisible()).toBe(true);

        const otherPath = path.join(tmpDir, "other.txt");
        fs.writeFileSync(otherPath, "bar");
        group.openFile(otherPath);
        testApp.render();

        expect(find.isVisible()).toBe(false);
    });

    it("isVisible() is false before the host view is attached", () => {
        const { group, themeService } = makeGroup();
        const component = new FindComponent();
        const find = new FindService(component, group);
        expect(find.isVisible()).toBe(false);
    });

    it("open() / hide() before the host view is attached are no-ops and do not throw", () => {
        const { group, themeService } = makeGroup();
        const component = new FindComponent();
        const find = new FindService(component, group);
        expect(() => {
            find.open();
        }).not.toThrow();
        expect(find.isVisible()).toBe(false);
        expect(() => {
            component.widgetIfExists(group.activeGroup.id)?.hide();
        }).not.toThrow();
        expect(find.isVisible()).toBe(false);
    });

    it("next()/prev() до присоединения view-слоя — no-op: виджета нет и не создать", () => {
        // Хоста нет — widgetFor вернёт null, навигация тихо выходит.
        const { group } = makeGroup();
        const component = new FindComponent();
        const find = new FindService(component, group);

        expect(() => {
            find.next();
            find.prev();
        }).not.toThrow();
        expect(find.isVisible()).toBe(false);
    });

    it("ввод запроса до первого open() — no-op: сессии ещё нет", () => {
        // Виджет создан лениво (setup), но сессию заводит только open()/навигация —
        // recompute по onQueryChange обязан тихо выйти, не трогая редактор.
        const { widget, editor } = setup("foo bar foo");

        typeQuery(widget, "foo");

        expect(editor.viewState.searchMatches).toEqual([]);
        expect(editor.viewState.currentSearchMatchIndex).toBe(-1);
    });

    it("next() tolerates the active editor disappearing after matches were found", () => {
        const { find, widget, group } = setup("foo bar foo");
        find.open();
        typeQuery(widget, "foo");

        // Editor closes (or detaches) while the widget is still open with stale matches.
        void widget;
        vi.spyOn(group, "getActiveEditor").mockReturnValue(null);
        expect(() => {
            find.next();
        }).not.toThrow();
    });

    it("opens without an active editor (empty group)", () => {
        const { group, groupComponent, themeService } = makeGroup();
        const body = new BodyElement();
        body.setContent(groupComponent.view);
        TestApp.create(body, new Size(80, 24)).render();
        const component = new FindComponent();
        component.hostProvider = () => groupComponent.view;
        const find = new FindService(component, group);

        expect(() => {
            find.open();
        }).not.toThrow();
        expect(find.isVisible()).toBe(true);
        expect(() => {
            typeQuery(component.widgetFor(group.activeGroup.id)!, "foo");
        }).not.toThrow();
        // close() with no active editor must still hide the widget (skips cursor restore).
        expect(() => {
            find.close();
        }).not.toThrow();
        expect(find.isVisible()).toBe(false);
    });
});
