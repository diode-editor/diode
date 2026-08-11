import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NULL_LOG_SERVICE } from "../../../platform/log/common/nullLogService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { createTestEditorContextMenuController } from "../../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../platform/files/common/iFileWatcher.ts";
import { WorkbenchTheme } from "../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";
import { TextEditorPane } from "../../browser/parts/editor/textEditorPane.ts";
import { EditorService } from "../../services/editor/browser/editorService.ts";
import { darkPlusTheme } from "../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../services/themes/common/themeService.ts";

import { EditorOptionsServiceAdapter } from "./editorOptionsServiceAdapter.ts";

/**
 * Адресация по группам поверх настоящего EditorService: `groupId` в
 * `setActiveEditorSelections` ставит выделение конкретной вью (AS-10), а правки
 * `applyActiveEditorEdits` находят документ в любой группе, не только активной.
 */
describe("EditorOptionsServiceAdapter — адресация по группам", () => {
    let ws: ITempWorkspace;
    let service: EditorService;
    let adapter: EditorOptionsServiceAdapter;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "vexx-options-groups-",
            files: { "a.ts": "alpha\nbeta", "b.ts": "gamma" },
        });
        service = new EditorService(
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
        adapter = new EditorOptionsServiceAdapter(service);
    });

    afterEach(() => {
        service.dispose();
        ws.dispose();
    });

    /** Текстовая вкладка группы по позиции — с проверкой вида. */
    function editorAt(groupIndex: number, tabIndex: number): TextEditorPane {
        const pane = service.groups[groupIndex].getPane(tabIndex);
        expect(pane instanceof TextEditorPane).toBe(true);
        return pane as TextEditorPane;
    }

    it("setActiveEditorSelections с groupId ставит выделение вью ТОЙ группы (AS-10)", () => {
        service.openFile(ws.path("a.ts"));
        service.splitActiveGroup(); // группа 2 — дубль a.ts со своим viewState
        service.focusGroup({ index: 0 });
        const uri = editorAt(0, 0).uri.toString();

        adapter.setActiveEditorSelections(
            uri,
            [{ anchorLine: 1, anchorCharacter: 0, activeLine: 1, activeCharacter: 2 }],
            service.groups[1].id,
        );

        // Выделение уехало во вторую группу, вью первой не тронута.
        expect(editorAt(1, 0).viewState.selections[0].active).toEqual({ line: 1, character: 2 });
        expect(editorAt(0, 0).viewState.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("setActiveEditorSelections: неизвестный groupId или чужой uri — no-op", () => {
        service.openFile(ws.path("a.ts"));
        const editor = service.getActiveEditor()!;
        const before = editor.viewState.selections[0];
        const selections = [{ anchorLine: 1, anchorCharacter: 1, activeLine: 1, activeCharacter: 1 }];

        // Группа умерла между запросом расширения и обработкой.
        adapter.setActiveEditorSelections(editor.uri.toString(), selections, 999);
        // В живой группе нет вкладки с этим uri.
        adapter.setActiveEditorSelections(Uri.file(ws.path("b.ts")).toString(), selections, service.activeGroup.id);

        expect(editor.viewState.selections[0]).toEqual(before);
    });

    it("applyActiveEditorEdits находит документ в неактивной группе; неоткрытый ресурс — false", () => {
        service.openFile(ws.path("a.ts"));
        const background = service.getActiveEditor()!;
        service.splitActiveGroup();
        service.openFile(ws.path("b.ts")); // активная вкладка второй группы — b.ts
        const edit = { range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 }, text: "x" };

        expect(adapter.applyActiveEditorEdits(background.uri.toString(), [edit])).toBe(true);
        expect(background.model.getText()).toBe("xalpha\nbeta");

        expect(adapter.applyActiveEditorEdits(Uri.file(ws.path("nope.ts")).toString(), [edit])).toBe(false);
    });
});
