import * as fs from "node:fs";
import * as path from "node:path";

import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import type { EditorTabStripElement } from "@tuidom/elements/editorgroup/editorTabStripElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestContextMenuService } from "../../../../../TestUtils/testContextMenuService.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { menuItemsOfAction } from "../../actions/menuContributions.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { closeAllEditorsAction, splitEditorDownAction, splitEditorRightAction } from "../../actions/editorGroupActions.ts";
import { closeActiveEditorAction } from "../../actions/tabActions.ts";
import { TAB_CLOSE_ACTIONS } from "../../actions/tabCloseActions.ts";
import { revealActiveFileInExplorerAction } from "../../actions/layoutActions.ts";
import { fileCopyPathAction, fileCopyRelativePathAction } from "../../../contrib/files/browser/fileTreeClipboardActions.ts";
import { EditorService } from "../../../services/editor/browser/editorService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { DiffEditorPane2 } from "./diffEditorPane2.ts";
import { EditorGroupComponent } from "./editorGroupComponent.ts";

const SCREEN = new Size(90, 12);
/** Полоса вкладок — верхний ряд группы. */
const TAB_ROW = 0;

/**
 * Пункты меню вкладки собираются из co-located размещений тех же экшенов, что
 * регистрирует `builtinActions` — так тест видит ровно тот состав, который
 * увидит пользователь, а не выдуманный.
 */
const TAB_MENU_ACTIONS = [
    closeActiveEditorAction,
    ...TAB_CLOSE_ACTIONS,
    closeAllEditorsAction,
    splitEditorRightAction,
    splitEditorDownAction,
    fileCopyPathAction,
    fileCopyRelativePathAction,
    revealActiveFileInExplorerAction,
];

function rightClick(x: number, y: number, action: "press" | "release"): MouseToken {
    return {
        kind: "mouse",
        button: "right",
        x: x + 1,
        y: y + 1,
        action,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

function leftClick(x: number, y: number, action: "press" | "release"): MouseToken {
    return { ...rightClick(x, y, action), button: "left" };
}

interface Harness {
    app: TestApp;
    service: EditorService;
    component: EditorGroupComponent;
    /** Открывает меню правым кликом по вкладке с этим индексом. */
    openMenuOnTab: (index: number) => void;
    /** Правый клик по колонке крестика вкладки. */
    rightClickCloseButton: (index: number) => void;
    /** Левый клик по колонке крестика вкладки — контрольный «крестик работает». */
    leftClickCloseButton: (index: number) => void;
    tabLabels: () => string[];
    activeIndex: () => number;
}

function menuItems(app: TestApp): (string | null)[] {
    const menu = app.querySelector("PopupMenuElement");
    const state = menu?.inspectState();
    if (state === undefined) throw new Error("контекстное меню не открыто");
    return state.items as (string | null)[];
}

function isMenuOpen(app: TestApp): boolean {
    return app.querySelector("PopupMenuElement") !== null;
}

function createHarness(): Harness {
    const themeService = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    const service = new EditorService(
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
    const commands = new CommandRegistry();
    for (const action of TAB_MENU_ACTIONS) commands.register(action.id, () => undefined, action.title);
    const contextMenuService = createTestContextMenuService({
        commands,
        contributions: TAB_MENU_ACTIONS.flatMap(menuItemsOfAction),
    });
    const component = new EditorGroupComponent(service.activeGroup, service, contextMenuService);
    const app = TestApp.createWithContent(component.view, SCREEN);
    app.render();

    const strip = (): EditorTabStripElement =>
        component.view.querySelector("EditorTabStripElement") as EditorTabStripElement;
    const tabBox = (index: number): { start: number; width: number } => {
        const item = strip().getItemElements()[index];
        return { start: item.globalPosition.x, width: item.layoutSize.width };
    };
    const clickAt = (x: number, button: "left" | "right"): void => {
        const token = button === "right" ? rightClick : leftClick;
        app.backend.simulateMouse(token(x, TAB_ROW, "press"));
        app.backend.simulateMouse(token(x, TAB_ROW, "release"));
        app.render();
    };

    return {
        app,
        service,
        component,
        openMenuOnTab: (index) => {
            const { start } = tabBox(index);
            // По метке, а не по краю: центр вкладки — обычная её область.
            clickAt(start + 2, "right");
        },
        // Крестик живёт в предпоследней колонке (paddingRight=2 у стрипа).
        rightClickCloseButton: (index) => {
            const { start, width } = tabBox(index);
            clickAt(start + width - 3, "right");
        },
        leftClickCloseButton: (index) => {
            const { start, width } = tabBox(index);
            clickAt(start + width - 3, "left");
        },
        tabLabels: () =>
            strip()
                .getItemElements()
                .map((item) => item.getLabel()),
        activeIndex: () => service.activeGroup.activeIndex,
    };
}

describe("EditorGroupComponent — контекстное меню вкладки", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-test-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function writeFile(name: string, content = "x"): string {
        const filePath = path.join(ws.dir, name);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, "utf-8");
        return filePath;
    }

    function openFiles(harness: Harness, ...names: string[]): void {
        for (const name of names) harness.service.openFile(writeFile(name));
        harness.app.render();
    }

    it("правый клик по вкладке открывает меню и НЕ делает её активной", () => {
        const harness = createHarness();
        openFiles(harness, "a.ts", "b.ts", "c.ts");
        expect(harness.activeIndex()).toBe(2);

        harness.openMenuOnTab(0);

        expect(isMenuOpen(harness.app)).toBe(true);
        expect(harness.activeIndex()).toBe(2);
    });

    it("правый клик по крестику вкладку не закрывает — только открывает меню", () => {
        const harness = createHarness();
        openFiles(harness, "a.ts", "b.ts");

        harness.rightClickCloseButton(0);

        expect(harness.tabLabels()).toEqual(["a.ts", "b.ts"]);
        expect(isMenuOpen(harness.app)).toBe(true);
    });

    it("левый клик по тому же крестику вкладку закрывает (контроль)", () => {
        const harness = createHarness();
        openFiles(harness, "a.ts", "b.ts");

        harness.leftClickCloseButton(0);

        expect(harness.tabLabels()).toEqual(["b.ts"]);
        expect(isMenuOpen(harness.app)).toBe(false);
    });

    it("состав меню на средней вкладке — полный, с разделителями по группам", () => {
        const harness = createHarness();
        openFiles(harness, "a.ts", "b.ts", "c.ts");

        harness.openMenuOnTab(1);

        expect(menuItems(harness.app)).toEqual([
            "Close",
            "Close Others",
            "Close to the Right",
            "Close Saved",
            "Close All",
            null,
            "Split Right",
            "Split Down",
            null,
            "Copy Path",
            "Copy Relative Path",
            null,
            "Reveal in Explorer View",
        ]);
    });

    it("на последней вкладке нет «Close to the Right»", () => {
        const harness = createHarness();
        openFiles(harness, "a.ts", "b.ts");

        harness.openMenuOnTab(1);

        expect(menuItems(harness.app)).not.toContain("Close to the Right");
        expect(menuItems(harness.app)).toContain("Close Others");
    });

    it("у единственной вкладки нет ни «Close Others», ни «Close to the Right»", () => {
        const harness = createHarness();
        openFiles(harness, "a.ts");

        harness.openMenuOnTab(0);

        const items = menuItems(harness.app);
        expect(items).not.toContain("Close Others");
        expect(items).not.toContain("Close to the Right");
        expect(items).toContain("Close");
    });

    it("у безымянного буфера нет файловых пунктов", () => {
        const harness = createHarness();
        harness.service.newUntitled();
        harness.app.render();

        harness.openMenuOnTab(0);

        const items = menuItems(harness.app);
        expect(items).not.toContain("Copy Path");
        expect(items).not.toContain("Copy Relative Path");
        expect(items).not.toContain("Reveal in Explorer View");
    });

    it("у вкладки диффа тоже нет файловых пунктов — пути у неё нет", () => {
        const harness = createHarness();
        const diff = new DiffEditorPane2(
            NULL_LANGUAGE_SERVICE,
            new UndoRedoService(),
            new TokenizationRegistry(),
            NULL_TOKEN_STYLE_RESOLVER,
            {
                uri: Uri.from({ scheme: "diode-diff", path: "/pair", query: "left=a&right=b" }),
                label: "a ↔ b",
                originalLabel: "a",
                modifiedLabel: "b",
                original: { kind: "snapshot", text: "a" },
                modified: { kind: "snapshot", text: "b" },
                languageId: "plaintext",
            },
        );
        harness.service.openPane(diff);
        harness.app.render();

        harness.openMenuOnTab(0);

        const items = menuItems(harness.app);
        expect(items).not.toContain("Copy Path");
        expect(items).not.toContain("Reveal in Explorer View");
        expect(items).toContain("Close");
    });

    it("«Close Saved» виден, когда изменена только часть вкладок", () => {
        const harness = createHarness();
        openFiles(harness, "a.ts", "b.ts", "c.ts");
        const pane = harness.service.getActiveEditor();
        if (pane === null) throw new Error("вкладка не открылась");
        pane.pushUndo(pane.viewState.type("dirty"));
        harness.app.render();

        harness.openMenuOnTab(0);

        // Смешанный набор — единственный случай, где «есть хоть одна чистая» и
        // «чисты все» расходятся: на всех чистых и на всех грязных пункт ведёт
        // себя одинаково, и проверки выше эту разницу не видят.
        expect(menuItems(harness.app)).toContain("Close Saved");
    });

    it("«Close Saved» прячется, когда все вкладки изменены", () => {
        const harness = createHarness();
        openFiles(harness, "a.ts");
        const pane = harness.service.getActiveEditor();
        if (pane === null) throw new Error("вкладка не открылась");
        pane.pushUndo(pane.viewState.type("dirty"));
        harness.app.render();

        harness.openMenuOnTab(0);

        expect(menuItems(harness.app)).not.toContain("Close Saved");
    });
});
