import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestActiveEditorService } from "../../../../../TestUtils/testActiveEditorService.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createCursorSelection, createSelection } from "../../../../editor/common/core/iSelection.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { MULTI_CURSOR_ACTIONS } from "./multiCursorActions.ts";

let ws: ITempWorkspace;

function openEditor(content: string) {
    const editor = createEditorPane();
    editor.openFile(Uri.file(ws.writeFile("doc.txt", content)));
    const service = createTestActiveEditorService(editor);

    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry();
    const accessor = new Container();
    accessor.bind(EditorServiceDIToken, () => service);
    for (const action of MULTI_CURSOR_ACTIONS) {
        registerAction(commands, keybindings, accessor, action);
    }
    return { editor, commands, keybindings, service };
}

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-multi-cursor-actions-" });
});
afterEach(() => {
    ws.dispose();
});

describe("MULTI_CURSOR_ACTIONS — reachable by id", () => {
    it("insertCursorBelow adds a cursor", () => {
        const { editor, commands } = openEditor("alpha\nbeta");
        commands.execute("editor.action.insertCursorBelow");
        expect(editor.viewState.selections).toHaveLength(2);
    });

    it("insertCursorAbove adds a cursor", () => {
        const { editor, commands } = openEditor("alpha\nbeta");
        editor.viewState.selections = [createCursorSelection(1, 0)];
        commands.execute("editor.action.insertCursorAbove");
        expect(editor.viewState.selections).toHaveLength(2);
    });

    it("removeSecondaryCursors collapses the set", () => {
        const { editor, commands } = openEditor("alpha\nbeta");
        commands.execute("editor.action.insertCursorBelow");
        commands.execute("removeSecondaryCursors");
        expect(editor.viewState.selections).toHaveLength(1);
    });

    it("insertCursorAtEndOfEachLineSelected places cursors at line ends", () => {
        const { editor, commands } = openEditor("alpha\nbeta");
        editor.viewState.selections = [createSelection(0, 0, 1, 4)];
        commands.execute("editor.action.insertCursorAtEndOfEachLineSelected");
        expect(editor.viewState.selections.map((sel) => sel.active.line)).toEqual([0, 1]);
    });

    it("addSelectionToNextFindMatch selects the word, then the next occurrence", () => {
        const { editor, commands } = openEditor("foo\nfoo");
        commands.execute("editor.action.addSelectionToNextFindMatch");
        commands.execute("editor.action.addSelectionToNextFindMatch");
        expect(editor.viewState.selections).toHaveLength(2);
    });

    it("addSelectionToPreviousFindMatch adds the occurrence above", () => {
        const { editor, commands } = openEditor("foo\nfoo");
        editor.viewState.selections = [createCursorSelection(1, 0)];
        commands.execute("editor.action.addSelectionToPreviousFindMatch");
        commands.execute("editor.action.addSelectionToPreviousFindMatch");
        expect(editor.viewState.selections.map((sel) => sel.active.line)).toEqual([0, 1]);
    });

    it("moveSelectionToNextFindMatch moves the last selection", () => {
        const { editor, commands } = openEditor("foo\nfoo\nfoo");
        commands.execute("editor.action.addSelectionToNextFindMatch");
        commands.execute("editor.action.addSelectionToNextFindMatch");
        commands.execute("editor.action.moveSelectionToNextFindMatch");
        expect(editor.viewState.selections.map((sel) => sel.active.line)).toEqual([0, 2]);
    });

    it("moveSelectionToPreviousFindMatch moves it back", () => {
        const { editor, commands } = openEditor("foo\nfoo\nfoo");
        commands.execute("editor.action.addSelectionToNextFindMatch");
        commands.execute("editor.action.addSelectionToNextFindMatch");
        commands.execute("editor.action.moveSelectionToPreviousFindMatch");
        expect(editor.viewState.selections.map((sel) => sel.active.line)).toEqual([0, 2]);
    });

    it("selectHighlights selects all occurrences at once", () => {
        const { editor, commands } = openEditor("foo\nfoo\nfoo");
        commands.execute("editor.action.selectHighlights");
        expect(editor.viewState.selections).toHaveLength(3);
    });

    it("changeAll is the same multi-cursor over occurrences under the upstream name", () => {
        const { editor, commands } = openEditor("foo\nfoo\nfoo");
        commands.execute("editor.action.changeAll");
        expect(editor.viewState.selections).toHaveLength(3);
    });

    it("without an active editor all commands are a silent no-op", () => {
        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => createTestActiveEditorService(null));
        for (const action of MULTI_CURSOR_ACTIONS) registerAction(commands, keybindings, accessor, action);
        for (const action of MULTI_CURSOR_ACTIONS) {
            expect(() => commands.execute(action.id)).not.toThrow();
        }
    });
});

describe("removeSecondaryCursors — when gate", () => {
    function resolveEscape(keybindings: KeybindingRegistry, hasMultiple: boolean) {
        const contextKeys = new ContextKeyService();
        contextKeys.set("textViewFocus", true);
        contextKeys.set("editorHasMultipleSelections", hasMultiple);
        return keybindings.resolveKey(parseKeybinding("escape"), contextKeys);
    }

    it("Escape is intercepted only with more than one cursor", () => {
        const { keybindings } = openEditor("alpha\nbeta");
        expect(resolveEscape(keybindings, true)).toEqual({
            kind: "command",
            commandId: "removeSecondaryCursors",
            when: "textViewFocus && editorHasMultipleSelections",
        });
    });

    it("with one cursor Escape is free for the find widget and the suggest popup", () => {
        const { keybindings } = openEditor("alpha\nbeta");
        expect(resolveEscape(keybindings, false)).toEqual({ kind: "none" });
    });
});
