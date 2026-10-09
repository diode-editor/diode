import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestActiveEditorService } from "../../../../../TestUtils/testActiveEditorService.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { redoAction, undoAction } from "../../../browser/actions/editorEditActions.ts";
import { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { insertFinalNewLineAction, trimTrailingWhitespaceAction } from "./whitespaceActions.ts";

let ws: ITempWorkspace;

function openEditor(content: string) {
    const editor = createEditorPane();
    editor.openFile(Uri.file(ws.writeFile("doc.txt", content)));
    const ctrl = createTestActiveEditorService(editor);

    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry();
    const accessor = new Container();
    accessor.bind(EditorServiceDIToken, () => ctrl);

    function exec(action: CommandAction): void {
        registerAction(commands, keybindings, accessor, action);
        commands.execute(action.id);
    }
    return { ctrl, editor, exec };
}

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-whitespace-actions-" });
});
afterEach(() => {
    ws.dispose();
});

describe("WhitespaceActions — trimTrailingWhitespace", () => {
    it("removes trailing spaces and tabs from every line, leaving inner whitespace", () => {
        const { editor, exec } = openEditor("a b  \nc\td\t\n  keep  x   ");
        exec(trimTrailingWhitespaceAction);
        expect(editor.getText()).toBe("a b\nc\td\n  keep  x");
    });

    it("не плодит каретки по числу строк: одна каретка остаётся одной и сдвигается к обрезанному концу", () => {
        // Регрессия: батч ставил каретку в конец КАЖДОЙ правки — по каретке на
        // каждую обрезанную строку. Как в эталоне, выделения лишь сдвигаются.
        const { editor, exec } = openEditor("a  \nbb   \ncc\t\nd");
        editor.viewState.selections = [createCursorSelection(1, 4)];

        exec(trimTrailingWhitespaceAction);

        expect(editor.getText()).toBe("a\nbb\ncc\nd");
        expect(editor.viewState.selections.map((sel) => [sel.active.line, sel.active.character])).toEqual([[1, 2]]);
    });

    it("каретка вне обрезаемого хвоста остаётся на месте", () => {
        const { editor, exec } = openEditor("a  \nbbb\ncc  ");
        editor.viewState.selections = [createCursorSelection(1, 1)];

        exec(trimTrailingWhitespaceAction);

        expect(editor.viewState.selections.map((sel) => [sel.active.line, sel.active.character])).toEqual([[1, 1]]);
    });

    it("is a no-op on already-clean text (content and version unchanged)", () => {
        const { editor, exec } = openEditor("clean\nlines\n");
        expect(editor.isModified).toBe(false);
        exec(trimTrailingWhitespaceAction);
        expect(editor.getText()).toBe("clean\nlines\n");
        expect(editor.isModified).toBe(false);
    });
});

describe("WhitespaceActions — insertFinalNewLine", () => {
    it("appends a single trailing newline when missing", () => {
        const { editor, exec } = openEditor("no newline");
        exec(insertFinalNewLineAction);
        expect(editor.getText()).toBe("no newline\n");
    });

    it("is a no-op when a final newline already exists", () => {
        const { editor, exec } = openEditor("has newline\n");
        expect(editor.isModified).toBe(false);
        exec(insertFinalNewLineAction);
        expect(editor.getText()).toBe("has newline\n");
        expect(editor.isModified).toBe(false);
    });

    it("is a no-op on an empty document", () => {
        const { editor, exec } = openEditor("");
        exec(insertFinalNewLineAction);
        expect(editor.getText()).toBe("");
        expect(editor.isModified).toBe(false);
    });
});

describe("WhitespaceActions — undo / redo round-trip", () => {
    it("undo restores trailing whitespace and redo re-trims it", () => {
        const { editor, exec } = openEditor("trailing   \nspace  ");
        exec(trimTrailingWhitespaceAction);
        expect(editor.getText()).toBe("trailing\nspace");

        exec(undoAction);
        expect(editor.getText()).toBe("trailing   \nspace  ");

        exec(redoAction);
        expect(editor.getText()).toBe("trailing\nspace");
    });

    it("undo removes the inserted final newline", () => {
        const { editor, exec } = openEditor("line");
        exec(insertFinalNewLineAction);
        expect(editor.getText()).toBe("line\n");

        exec(undoAction);
        expect(editor.getText()).toBe("line");
    });
});

describe("WhitespaceActions — safety without an active editor", () => {
    it("trim / insertFinalNewLine do not throw with no active editor", () => {
        const ctrl = createTestActiveEditorService(null);
        const commands = new CommandRegistry();
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => ctrl);
        for (const action of [trimTrailingWhitespaceAction, insertFinalNewLineAction]) {
            registerAction(commands, new KeybindingRegistry(), accessor, action);
            expect(() => commands.execute(action.id)).not.toThrow();
        }
    });
});
