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

/**
 * Фасад «открытые редакторы» — то, чем питается пикер `edt `
 * (`workbench.action.showAllEditors`): список вкладок ВСЕХ групп в MRU-порядке
 * и переход на выбранную вкладку через границу группы.
 */
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

describe("EditorService — список открытых редакторов и переход на вкладку", () => {
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
        return ctrl.getOpenEditorsMru().map((pane) => pane.label);
    }

    it("одна группа: вкладки в MRU-порядке, активная — первой", () => {
        const ctrl = createEditorService();
        ctrl.openFile(writeFile("a.ts"));
        ctrl.openFile(writeFile("b.ts"));
        ctrl.openFile(writeFile("c.ts"));

        expect(labels(ctrl)).toEqual(["c.ts", "b.ts", "a.ts"]);

        ctrl.activateTab(0);

        expect(labels(ctrl)).toEqual(["a.ts", "c.ts", "b.ts"]);
    });

    it("сплит: сперва вкладки активной группы, потом остальных по полосе", () => {
        const ctrl = createEditorService();
        ctrl.openFile(writeFile("a.ts"));
        ctrl.openFile(writeFile("b.ts"));
        // Сплит дублирует активную вкладку в новую группу и делает её активной.
        ctrl.splitActiveGroup();
        ctrl.openFile(writeFile("c.ts"));

        // Активная группа (вторая) первой: её MRU — c, b; следом первая: b, a.
        expect(labels(ctrl)).toEqual(["c.ts", "b.ts", "b.ts", "a.ts"]);

        ctrl.focusGroup(ctrl.groups[0].id);

        expect(labels(ctrl)).toEqual(["b.ts", "a.ts", "c.ts", "b.ts"]);
    });

    it("вкладки, слитые из чужой группы, из списка не пропадают", () => {
        const ctrl = createEditorService();
        ctrl.openFile(writeFile("a.ts"));
        ctrl.splitActiveGroup();
        ctrl.openFile(writeFile("b.ts"));
        // joinTwoGroups переносит вкладки без активации — мимо MRU-стека цели.
        ctrl.focusGroup(ctrl.groups[0].id);
        ctrl.joinTwoGroups();

        // b приехала merge'ом и в MRU-стеке цели не значится — она хвостом списка,
        // но в списке: иначе пикер потерял бы половину вкладок после join.
        expect(labels(ctrl)).toEqual(["a.ts", "b.ts"]);
    });

    it("пустая полоса — пустой список", () => {
        expect(createEditorService().getOpenEditorsMru()).toEqual([]);
    });

    it("revealPane активирует вкладку своей группы", () => {
        const ctrl = createEditorService();
        ctrl.openFile(writeFile("a.ts"));
        ctrl.openFile(writeFile("b.ts"));
        const first = ctrl.getPanes()[0];

        ctrl.revealPane(first);

        expect(ctrl.activeGroup.activePane).toBe(first);
        expect(labels(ctrl)).toEqual(["a.ts", "b.ts"]);
    });

    it("revealPane через границу группы делает её группу активной", () => {
        const ctrl = createEditorService();
        ctrl.openFile(writeFile("a.ts"));
        ctrl.splitActiveGroup();
        ctrl.openFile(writeFile("b.ts"));
        const inFirstGroup = ctrl.groups[0].getPanes()[0];

        ctrl.revealPane(inFirstGroup);

        expect(ctrl.activeGroup).toBe(ctrl.groups[0]);
        expect(ctrl.activeGroup.activePane).toBe(inFirstGroup);
    });

    it("revealPane панели не из полосы (уже закрытой вкладки) — no-op", () => {
        const ctrl = createEditorService();
        ctrl.openFile(writeFile("a.ts"));
        ctrl.openFile(writeFile("b.ts"));
        const closed = ctrl.getPanes()[0];
        ctrl.closeTab(0);
        const activeBefore = ctrl.activeGroup.activePane;

        ctrl.revealPane(closed);

        expect(ctrl.activeGroup.activePane).toBe(activeBefore);
        expect(labels(ctrl)).toEqual(["b.ts"]);
    });
});
