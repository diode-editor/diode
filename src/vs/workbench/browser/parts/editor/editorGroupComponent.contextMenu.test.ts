import * as fs from "node:fs";
import * as path from "node:path";

import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import type { EditorTabStripElement } from "@tuidom/elements/editorgroup/editorTabStripElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { createTestContextMenuService } from "../../../../../TestUtils/testContextMenuService.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import {
    fileCopyPathAction,
    fileCopyRelativePathAction,
} from "../../../contrib/files/browser/fileTreeClipboardActions.ts";
import { EditorService } from "../../../services/editor/browser/editorService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";
import {
    closeAllEditorsAction,
    splitEditorDownAction,
    splitEditorRightAction,
} from "../../actions/editorGroupActions.ts";
import { revealActiveFileInExplorerAction } from "../../actions/layoutActions.ts";
import { menuItemsOfAction } from "../../actions/menuContributions.ts";
import { closeActiveEditorAction, keepEditorAction } from "../../actions/tabActions.ts";
import { TAB_CLOSE_ACTIONS } from "../../actions/tabCloseActions.ts";

import { DiffEditorPane2 } from "./diffEditorPane2.ts";
import { EditorGroupComponent } from "./editorGroupComponent.ts";

const SCREEN = new Size(90, 12);
const TAB_ROW = 0;

/** Taken from the co-located placements of `WORKBENCH_ACTIONS`, i.e. the set the user will see. */
const TAB_MENU_ACTIONS = [
    keepEditorAction,
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
    openMenuOnTab: (index: number) => void;
    rightClickCloseButton: (index: number) => void;
    /** Control case: the close button works. */
    leftClickCloseButton: (index: number) => void;
    tabLabels: () => string[];
    activeIndex: () => number;
}

function menuItems(app: TestApp): (string | null)[] {
    const menu = app.querySelector("PopupMenuElement");
    const state = menu?.inspectState();
    if (state === undefined) throw new Error("context menu is not open");
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
        // Registry defaults rather than the NULL service: `workbench.editor.enablePreview`
        // is read through the typed overload, which gets its default from the registry.
        createTestConfigurationService(),
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
    const component = new EditorGroupComponent(
        service.editorGroups.activeGroup,
        service,
        contextMenuService,
        service.editorGroups,
    );
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
            // On the label, not the edge: the middle of the tab is its plain area.
            clickAt(start + 2, "right");
        },
        // The close button sits in the second-to-last column (the strip has paddingRight=2).
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
        activeIndex: () => service.editorGroups.activeGroup.activeIndex,
    };
}

describe("EditorGroupComponent — tab context menu", () => {
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

    function openPreview(harness: Harness, name: string): void {
        harness.service.openFile(writeFile(name), { preview: true });
        harness.app.render();
    }

    it("right click on a tab opens the menu and does NOT activate it", () => {
        const harness = createHarness();
        openFiles(harness, "a.ts", "b.ts", "c.ts");
        expect(harness.activeIndex()).toBe(2);

        harness.openMenuOnTab(0);

        expect(isMenuOpen(harness.app)).toBe(true);
        expect(harness.activeIndex()).toBe(2);
    });

    it("right click on the close button does not close the tab — only opens the menu", () => {
        const harness = createHarness();
        openFiles(harness, "a.ts", "b.ts");

        harness.rightClickCloseButton(0);

        expect(harness.tabLabels()).toEqual(["a.ts", "b.ts"]);
        expect(isMenuOpen(harness.app)).toBe(true);
    });

    it("left click on the same close button closes the tab (control)", () => {
        const harness = createHarness();
        openFiles(harness, "a.ts", "b.ts");

        harness.leftClickCloseButton(0);

        expect(harness.tabLabels()).toEqual(["b.ts"]);
        expect(isMenuOpen(harness.app)).toBe(false);
    });

    it("menu on a middle tab is complete, with separators between groups", () => {
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

    it("the last tab has no 'Close to the Right'", () => {
        const harness = createHarness();
        openFiles(harness, "a.ts", "b.ts");

        harness.openMenuOnTab(1);

        expect(menuItems(harness.app)).not.toContain("Close to the Right");
        expect(menuItems(harness.app)).toContain("Close Others");
    });

    it("a single tab has neither 'Close Others' nor 'Close to the Right'", () => {
        const harness = createHarness();
        openFiles(harness, "a.ts");

        harness.openMenuOnTab(0);

        const items = menuItems(harness.app);
        expect(items).not.toContain("Close Others");
        expect(items).not.toContain("Close to the Right");
        expect(items).toContain("Close");
    });

    it("an untitled buffer has no file items", () => {
        const harness = createHarness();
        harness.service.newUntitled();
        harness.app.render();

        harness.openMenuOnTab(0);

        const items = menuItems(harness.app);
        expect(items).not.toContain("Copy Path");
        expect(items).not.toContain("Copy Relative Path");
        expect(items).not.toContain("Reveal in Explorer View");
    });

    it("a diff tab has no file items either — it has no path", () => {
        const harness = createHarness();
        const diff = new DiffEditorPane2(
            NULL_LANGUAGE_SERVICE,
            new UndoRedoService(),
            diskFileService(),
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

    it("'Close Saved' is shown when only some tabs are modified", () => {
        const harness = createHarness();
        openFiles(harness, "a.ts", "b.ts", "c.ts");
        const pane = harness.service.getActiveEditor();
        if (pane === null) throw new Error("tab did not open");
        pane.pushUndo(pane.viewState.type("dirty"));
        harness.app.render();

        harness.openMenuOnTab(0);

        // A mixed set is the only case where "at least one is saved" and "all are saved"
        // differ: with all saved or all dirty the item behaves the same, so the checks
        // above cannot see the difference.
        expect(menuItems(harness.app)).toContain("Close Saved");
    });

    it("'Close Saved' is hidden when all tabs are modified", () => {
        const harness = createHarness();
        openFiles(harness, "a.ts");
        const pane = harness.service.getActiveEditor();
        if (pane === null) throw new Error("tab did not open");
        pane.pushUndo(pane.viewState.type("dirty"));
        harness.app.render();

        harness.openMenuOnTab(0);

        expect(menuItems(harness.app)).not.toContain("Close Saved");
    });

    it("'Keep Open' is shown on a preview tab", () => {
        const harness = createHarness();
        openPreview(harness, "a.ts");

        harness.openMenuOnTab(0);

        expect(menuItems(harness.app)).toContain("Keep Open");
    });

    it("'Keep Open' is hidden on a pinned tab — nothing to pin", () => {
        const harness = createHarness();
        openFiles(harness, "a.ts");

        harness.openMenuOnTab(0);

        expect(menuItems(harness.app)).not.toContain("Keep Open");
    });

    it("'Keep Open' depends on the tab under the mouse, not the active one", () => {
        const harness = createHarness();
        openFiles(harness, "a.ts");
        openPreview(harness, "b.ts");

        // The menu on the pinned tab has no item, even though the preview is active…
        harness.openMenuOnTab(0);
        expect(menuItems(harness.app)).not.toContain("Keep Open");
        harness.app.sendKey("Escape");
        harness.app.render();

        // …while the menu on the preview itself shows it.
        harness.openMenuOnTab(1);
        expect(menuItems(harness.app)).toContain("Keep Open");
    });
});
