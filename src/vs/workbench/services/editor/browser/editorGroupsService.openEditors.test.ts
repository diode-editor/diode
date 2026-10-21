import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";

import { EditorService } from "./editorService.ts";

function createEditorService(): EditorService {
    return new EditorService(
        new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
        new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        NULL_LANGUAGE_SERVICE,
        NULL_CONFIGURATION_SERVICE,
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
        NULL_LOG_SERVICE,
    );
}

describe("EditorGroupsService — open editors list and revealing a tab", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-openeditors-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function writeFile(name: string): string {
        const filePath = path.join(ws.dir, name);
        fs.writeFileSync(filePath, name, "utf-8");
        return filePath;
    }

    function labels(ctrl: EditorService): string[] {
        return ctrl.editorGroups.getOpenEditorsMru().map((pane) => pane.label);
    }

    it("one group: tabs in MRU order, the active one first", () => {
        const ctrl = createEditorService();
        ctrl.openFile(writeFile("a.ts"));
        ctrl.openFile(writeFile("b.ts"));
        ctrl.openFile(writeFile("c.ts"));

        expect(labels(ctrl)).toEqual(["c.ts", "b.ts", "a.ts"]);

        ctrl.editorGroups.activeGroup.activateTab(0);

        expect(labels(ctrl)).toEqual(["a.ts", "c.ts", "b.ts"]);
    });

    it("split: the active group's tabs first, then the others in strip order", () => {
        const ctrl = createEditorService();
        ctrl.openFile(writeFile("a.ts"));
        ctrl.openFile(writeFile("b.ts"));
        ctrl.splitActiveGroup();
        ctrl.openFile(writeFile("c.ts"));

        // The active (second) group first: its MRU is c, b; then the first: b, a.
        expect(labels(ctrl)).toEqual(["c.ts", "b.ts", "b.ts", "a.ts"]);

        ctrl.editorGroups.focusGroup(ctrl.editorGroups.groups[0].id);

        expect(labels(ctrl)).toEqual(["b.ts", "a.ts", "c.ts", "b.ts"]);
    });

    it("tabs merged from another group do not drop out of the list", () => {
        const ctrl = createEditorService();
        ctrl.openFile(writeFile("a.ts"));
        ctrl.splitActiveGroup();
        ctrl.openFile(writeFile("b.ts"));
        // joinTwoGroups moves tabs without activation — bypassing the target's MRU stack.
        ctrl.editorGroups.focusGroup(ctrl.editorGroups.groups[0].id);
        ctrl.editorGroups.joinTwoGroups();

        // b, which arrived via merge, is at the tail of the list but present: otherwise the picker would lose tabs after a join.
        expect(labels(ctrl)).toEqual(["a.ts", "b.ts"]);
    });

    it("an empty strip yields an empty list", () => {
        expect(createEditorService().editorGroups.getOpenEditorsMru()).toEqual([]);
    });

    it("revealPane activates a tab in its own group", () => {
        const ctrl = createEditorService();
        ctrl.openFile(writeFile("a.ts"));
        ctrl.openFile(writeFile("b.ts"));
        const first = ctrl.editorGroups.activeGroup.getPanes()[0];

        ctrl.editorGroups.revealPane(first);

        expect(ctrl.editorGroups.activeGroup.activePane).toBe(first);
        expect(labels(ctrl)).toEqual(["a.ts", "b.ts"]);
    });

    it("revealPane across a group boundary makes its group active", () => {
        const ctrl = createEditorService();
        ctrl.openFile(writeFile("a.ts"));
        ctrl.splitActiveGroup();
        ctrl.openFile(writeFile("b.ts"));
        const inFirstGroup = ctrl.editorGroups.groups[0].getPanes()[0];

        ctrl.editorGroups.revealPane(inFirstGroup);

        expect(ctrl.editorGroups.activeGroup).toBe(ctrl.editorGroups.groups[0]);
        expect(ctrl.editorGroups.activeGroup.activePane).toBe(inFirstGroup);
    });

    it("revealPane of a pane not in the strip (an already closed tab) is a no-op", () => {
        const ctrl = createEditorService();
        ctrl.openFile(writeFile("a.ts"));
        ctrl.openFile(writeFile("b.ts"));
        const closed = ctrl.editorGroups.activeGroup.getPanes()[0];
        ctrl.editorGroups.activeGroup.closeTab(0);
        const activeBefore = ctrl.editorGroups.activeGroup.activePane;

        ctrl.editorGroups.revealPane(closed);

        expect(ctrl.editorGroups.activeGroup.activePane).toBe(activeBefore);
        expect(labels(ctrl)).toEqual(["b.ts"]);
    });
});
