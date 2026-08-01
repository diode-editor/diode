import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { createTestEditorContextMenuController } from "../../../../TestUtils/testEditorContextMenu.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../editor/common/languages/tokenizationRegistry.ts";
import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { registerAction } from "../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../platform/files/common/iFileWatcher.ts";
import { Container } from "../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { WorkbenchTheme } from "../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";
import { EditorService, EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";
import { darkPlusTheme } from "../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../services/themes/common/themeService.ts";

import { redoAction, undoAction } from "./editorEditActions.ts";
import { insertFinalNewLineAction, trimTrailingWhitespaceAction } from "./whitespaceActions.ts";

let ws: ITempWorkspace;

function createGroup(): EditorService {
    const themeService = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    return new EditorService(
        themeService,
        new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        NULL_LANGUAGE_SERVICE,
        NULL_CONFIGURATION_SERVICE,
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
    );
}

function openEditor(content: string) {
    const ctrl = createGroup();
    const filePath = ws.writeFile("doc.txt", content);
    ctrl.openFile(filePath);
    const editor = ctrl.getActiveEditor();
    if (editor === null) throw new Error("no active editor");

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
    ws = createTempWorkspace({ prefix: "vexx-whitespace-actions-" });
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
        const ctrl = createGroup();
        const commands = new CommandRegistry();
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => ctrl);
        for (const action of [trimTrailingWhitespaceAction, insertFinalNewLineAction]) {
            registerAction(commands, new KeybindingRegistry(), accessor, action);
            expect(() => commands.execute(action.id)).not.toThrow();
        }
    });
});
