import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../TestUtils/TestApp.ts";
import { createTestEditorContextMenuController } from "../../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../../base/common/uri.ts";
import { createSelection } from "../../../editor/common/core/iSelection.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";
import { TextEditorPane } from "../../browser/parts/editor/textEditorPane.ts";
import type { IBulkEditService } from "../../contrib/bulkEdit/common/iBulkEditService.ts";
import { EditorService } from "../../services/editor/browser/editorService.ts";
import { darkPlusTheme } from "../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../services/themes/common/themeService.ts";
import type { IActiveEditorSelections } from "../common/iEditorOptionsService.ts";

import { EditorOptionsServiceAdapter } from "./editorOptionsServiceAdapter.ts";
const NO_BULK_EDITS: IBulkEditService = { applyWorkspaceEdit: () => Promise.resolve(false) };

describe("EditorOptionsServiceAdapter: addressing by group", () => {
    let ws: ITempWorkspace;
    let service: EditorService;
    let adapter: EditorOptionsServiceAdapter;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-options-groups-",
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
        adapter = new EditorOptionsServiceAdapter(service, service.editorGroups, NO_BULK_EDITS);
    });

    afterEach(() => {
        service.dispose();
        ws.dispose();
    });

    /** The terminal cursor while the pane has focus. */
    function cursorOf(pane: TextEditorPane) {
        const app = TestApp.createWithContent(pane.view, new Size(20, 3));
        pane.focusEditor();
        app.render();
        return app.backend.cursorStyle;
    }

    function editorAt(groupIndex: number, tabIndex: number): TextEditorPane {
        const pane = service.editorGroups.groups[groupIndex].getPane(tabIndex);
        expect(pane instanceof TextEditorPane).toBe(true);
        return pane as TextEditorPane;
    }

    it("setActiveEditorSelections with groupId sets the selection on THAT group's view (AS-10)", () => {
        service.openFile(ws.path("a.ts"));
        service.splitActiveGroup();
        service.editorGroups.focusGroup({ index: 0 });
        const uri = editorAt(0, 0).uri.toString();

        adapter.setActiveEditorSelections(
            uri,
            [{ anchorLine: 1, anchorCharacter: 0, activeLine: 1, activeCharacter: 2 }],
            service.editorGroups.groups[1].id,
        );

        expect(editorAt(1, 0).viewState.selections[0].active).toEqual({ line: 1, character: 2 });
        expect(editorAt(0, 0).viewState.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("[api:window.onDidChangeTextEditorSelection] an extension's own selection comes back with kind Command, an unchanged one does not", async () => {
        service.openFile(ws.path("a.ts"));
        const editor = service.getActiveEditor()!;
        const uri = editor.uri.toString();
        const received: { kind?: number; line: number }[] = [];
        const subscription = adapter.onActiveEditorSelectionChanged((event) => {
            received.push({ kind: event.kind, line: event.selections[0].activeLine });
        });
        const selection = { anchorLine: 1, anchorCharacter: 0, activeLine: 1, activeCharacter: 2 };

        adapter.setActiveEditorSelections(uri, [selection]);
        await Promise.resolve();
        expect(received).toEqual([{ kind: 3, line: 1 }]);

        adapter.setActiveEditorSelections(uri, [selection]);
        await Promise.resolve();
        expect(received.length).toBe(1);

        // Differs from the current selection in one field only: each of them counts as a change.
        for (const moved of [
            { ...selection, anchorLine: 0 },
            { ...selection, anchorLine: 0, anchorCharacter: 1 },
            { ...selection, anchorLine: 0, anchorCharacter: 1, activeLine: 0 },
            { ...selection, anchorLine: 0, anchorCharacter: 1, activeLine: 0, activeCharacter: 3 },
        ]) {
            const before = received.length;
            adapter.setActiveEditorSelections(uri, [moved]);
            await Promise.resolve();
            expect(received.length).toBe(before + 1);
        }

        subscription.dispose();
    });

    it("[api:window.onDidChangeTextEditorSelection] a change in a later cursor counts, not only in the first", async () => {
        service.openFile(ws.path("a.ts"));
        const uri = service.getActiveEditor()!.uri.toString();
        const first = { anchorLine: 0, anchorCharacter: 0, activeLine: 0, activeCharacter: 1 };
        const second = { anchorLine: 1, anchorCharacter: 0, activeLine: 1, activeCharacter: 1 };
        adapter.setActiveEditorSelections(uri, [first, second]);
        await Promise.resolve();
        const seen: unknown[] = [];
        const subscription = adapter.onActiveEditorSelectionChanged((event) => seen.push(event));

        adapter.setActiveEditorSelections(uri, [first, { ...second, activeCharacter: 2 }]);
        await Promise.resolve();

        expect(seen.length).toBe(1);
        subscription.dispose();
    });

    it("[api:window.onDidChangeTextEditorSelection] the visible editor of an inactive group reports its own selection", async () => {
        service.openFile(ws.path("a.ts"));
        service.splitActiveGroup();
        const inactive = service.editorGroups.groups[0];
        const uri = editorAt(0, 0).uri.toString();
        const seen: { groupId?: number | null; kind?: number; line: number }[] = [];
        const subscription = adapter.onActiveEditorSelectionChanged((event) => {
            seen.push({ groupId: event.groupId, kind: event.kind, line: event.selections[0].activeLine });
        });

        adapter.setActiveEditorSelections(
            uri,
            [{ anchorLine: 1, anchorCharacter: 0, activeLine: 1, activeCharacter: 1 }],
            inactive.id,
        );
        await Promise.resolve();

        expect(seen).toEqual([{ groupId: inactive.id, kind: 3, line: 1 }]);

        // A group that became active reports through the active path, once.
        service.editorGroups.focusGroup(inactive.id);
        seen.length = 0;
        adapter.setActiveEditorSelections(
            uri,
            [{ anchorLine: 0, anchorCharacter: 0, activeLine: 0, activeCharacter: 1 }],
            inactive.id,
        );
        await Promise.resolve();
        expect(seen.length).toBe(1);

        // A closed tab is forgotten: its later changes report nothing.
        const closed = editorAt(1, 0);
        await service.closeAllEditors(service.editorGroups.groups[1]);
        seen.length = 0;
        closed.viewState.selections = [createSelection(1, 0, 1, 2)];
        await Promise.resolve();
        expect(seen).toEqual([]);

        subscription.dispose();
    });

    it("[api:window.onDidChangeTextEditorSelection] an inactive editor reports every tick, without a kind when the source is unknown", async () => {
        service.openFile(ws.path("a.ts"));
        service.splitActiveGroup();
        const inactive = editorAt(0, 0);
        const seen: IActiveEditorSelections[] = [];
        const subscription = adapter.onActiveEditorSelectionChanged((event) => seen.push(event));

        inactive.viewState.selections = [createSelection(1, 0, 1, 1)];
        await Promise.resolve();
        inactive.viewState.selections = [createSelection(1, 0, 1, 2)];
        await Promise.resolve();

        expect(seen.map((event) => event.selections[0].activeCharacter)).toEqual([1, 2]);
        expect(seen[0]).not.toHaveProperty("kind");
        subscription.dispose();
    });

    it("setActiveEditorSelections: unknown groupId or foreign uri is a no-op", () => {
        service.openFile(ws.path("a.ts"));
        const editor = service.getActiveEditor()!;
        const before = editor.viewState.selections[0];
        const selections = [{ anchorLine: 1, anchorCharacter: 1, activeLine: 1, activeCharacter: 1 }];

        // The group died between the extension's request and its handling.
        adapter.setActiveEditorSelections(editor.uri.toString(), selections, 999);
        // The live group has no tab with this uri.
        adapter.setActiveEditorSelections(
            Uri.file(ws.path("b.ts")).toString(),
            selections,
            service.editorGroups.activeGroup.id,
        );

        expect(editor.viewState.selections[0]).toEqual(before);
    });

    it("applyActiveEditorEdits finds the document in an inactive group; an unopened resource returns false", () => {
        service.openFile(ws.path("a.ts"));
        const background = service.getActiveEditor()!;
        service.splitActiveGroup();
        service.openFile(ws.path("b.ts")); // the second group's active tab is b.ts
        const edit = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "x" };

        expect(adapter.applyActiveEditorEdits(background.uri.toString(), [edit])).toBe(true);
        expect(background.model.getText()).toBe("xalpha\nbeta");

        expect(adapter.applyActiveEditorEdits(Uri.file(ws.path("nope.ts")).toString(), [edit])).toBe(false);
    });

    it("setEditorCursorStyle shapes THAT group's tab; an unknown group or a foreign uri is a no-op", () => {
        service.openFile(ws.path("a.ts"));
        service.splitActiveGroup();
        const uri = editorAt(0, 0).uri.toString();

        adapter.setEditorCursorStyle(uri, service.editorGroups.groups[0].id, "block");
        adapter.setEditorCursorStyle(uri, 999, "underline");
        adapter.setEditorCursorStyle(Uri.file(ws.path("b.ts")).toString(), service.editorGroups.groups[1].id, "line");

        expect(cursorOf(editorAt(0, 0))).toEqual({ shape: "block", blinking: true });
        expect(cursorOf(editorAt(1, 0))).toBeNull();
    });
});
