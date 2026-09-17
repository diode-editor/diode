import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { createTestEditorContextMenuController } from "../../../../TestUtils/testEditorContextMenu.ts";
import { createCursorSelection, createSelection } from "../../../editor/common/core/iSelection.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../editor/common/languages/tokenizationRegistry.ts";
import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { registerAction } from "../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../platform/files/common/iFileWatcher.ts";
import { Container } from "../../../platform/instantiation/common/diContainer.ts";
import {
    KeybindingRegistry,
    parseChord,
    parseKeybinding,
} from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { NULL_LOG_SERVICE } from "../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";
import { EditorService, EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";
import { darkPlusTheme } from "../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../services/themes/common/themeService.ts";

import {
    copyLinesDownAction,
    copyLinesUpAction,
    deleteLinesAction,
    duplicateSelectionAction,
    moveLinesDownAction,
    moveLinesUpAction,
} from "./lineOperationActions.ts";

let ws: ITempWorkspace;

function createService(): EditorService {
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
        NULL_LOG_SERVICE,
    );
}

function openEditor(content: string) {
    const ctrl = createService();
    const filePath = ws.writeFile("doc.txt", content);
    ctrl.openFile(filePath);
    const editor = ctrl.getActiveEditor();
    if (editor === null) throw new Error("no active editor");

    const commands = new CommandRegistry();
    const accessor = new Container();
    accessor.bind(EditorServiceDIToken, () => ctrl);

    async function exec(action: CommandAction): Promise<void> {
        registerAction(commands, new KeybindingRegistry(), accessor, action);
        await commands.execute(action.id);
    }
    return { ctrl, editor, exec };
}

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-line-ops-" });
});
afterEach(() => {
    ws.dispose();
});

describe("line operation actions", () => {
    it("copyLinesDown дублирует строку и уводит каретку на нижнюю копию", async () => {
        const { editor, exec } = openEditor("alpha\nbeta");
        editor.viewState.selections = [createCursorSelection(0, 2)];

        await exec(copyLinesDownAction);

        expect(editor.getText()).toBe("alpha\nalpha\nbeta");
        expect(editor.viewState.selections[0].active).toEqual({ line: 1, character: 2 });
    });

    it("copyLinesUp дублирует строку, каретка остаётся на верхней", async () => {
        const { editor, exec } = openEditor("alpha\nbeta");
        editor.viewState.selections = [createCursorSelection(0, 2)];

        await exec(copyLinesUpAction);

        expect(editor.getText()).toBe("alpha\nalpha\nbeta");
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 2 });
    });

    it("duplicateSelection дублирует выделенный текст и выделяет копию", async () => {
        const { editor, exec } = openEditor("hello world");
        editor.viewState.selections = [createSelection(0, 0, 0, 5)];

        await exec(duplicateSelectionAction);

        expect(editor.getText()).toBe("hellohello world");
        expect(editor.viewState.selections[0].anchor).toEqual({ line: 0, character: 5 });
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 10 });
    });

    it("moveLinesDown/Up перемещают строку туда и обратно", async () => {
        const { editor, exec } = openEditor("a\nb\nc");
        editor.viewState.selections = [createCursorSelection(0, 0)];

        await exec(moveLinesDownAction);
        expect(editor.getText()).toBe("b\na\nc");
        expect(editor.viewState.selections[0].active.line).toBe(1);

        await exec(moveLinesUpAction);
        expect(editor.getText()).toBe("a\nb\nc");
        expect(editor.viewState.selections[0].active.line).toBe(0);
    });

    it("deleteLines удаляет строку каретки", async () => {
        const { editor, exec } = openEditor("alpha\nbeta\ngamma");
        editor.viewState.selections = [createCursorSelection(1, 2)];

        await exec(deleteLinesAction);

        expect(editor.getText()).toBe("alpha\ngamma");
        expect(editor.viewState.selections[0].active).toEqual({ line: 1, character: 2 });
    });

    it("операция — один элемент undo: откат возвращает и текст, и выделение", async () => {
        const { editor, exec } = openEditor("alpha\nbeta");
        editor.viewState.selections = [createCursorSelection(0, 2)];

        await exec(copyLinesDownAction);
        expect(editor.getText()).toBe("alpha\nalpha\nbeta");

        editor.undo();
        expect(editor.getText()).toBe("alpha\nbeta");
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 2 });
    });

    it("undo после deleteLines возвращает удалённые строки одним шагом", async () => {
        const { editor, exec } = openEditor("a\nb\nc\nd");
        editor.viewState.selections = [createSelection(1, 0, 2, 1)];

        await exec(deleteLinesAction);
        expect(editor.getText()).toBe("a\nd");

        editor.undo();
        expect(editor.getText()).toBe("a\nb\nc\nd");
    });

    it("без активного текстового редактора все операции — безопасные no-op", async () => {
        const ctrl = createService(); // ни одной открытой вкладки
        const commands = new CommandRegistry();
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => ctrl);
        const actions = [
            copyLinesUpAction,
            copyLinesDownAction,
            duplicateSelectionAction,
            moveLinesUpAction,
            moveLinesDownAction,
            deleteLinesAction,
        ];
        for (const action of actions) {
            registerAction(commands, new KeybindingRegistry(), accessor, action);
            expect(() => commands.execute(action.id)).not.toThrow();
        }
    });

    it("метаданные запиннены: id/title/бинды/when — пользовательский контракт", () => {
        expect(copyLinesUpAction.id).toBe("editor.action.copyLinesUpAction");
        expect(copyLinesUpAction.title).toBe("Copy Line Up");
        expect(copyLinesUpAction.keybinding).toEqual(parseKeybinding("ctrl+shift+alt+up"));
        expect(copyLinesUpAction.when).toBe("textInputFocus && !editorReadonly");

        expect(copyLinesDownAction.id).toBe("editor.action.copyLinesDownAction");
        expect(copyLinesDownAction.title).toBe("Copy Line Down");
        expect(copyLinesDownAction.keybinding).toEqual(parseKeybinding("ctrl+shift+alt+down"));
        expect(copyLinesDownAction.when).toBe("textInputFocus && !editorReadonly");

        expect(moveLinesUpAction.id).toBe("editor.action.moveLinesUpAction");
        expect(moveLinesUpAction.title).toBe("Move Line Up");
        expect(moveLinesUpAction.keybinding).toEqual(parseKeybinding("alt+up"));
        expect(moveLinesUpAction.when).toBe("textInputFocus && !editorReadonly");

        expect(moveLinesDownAction.id).toBe("editor.action.moveLinesDownAction");
        expect(moveLinesDownAction.title).toBe("Move Line Down");
        expect(moveLinesDownAction.keybinding).toEqual(parseKeybinding("alt+down"));
        expect(moveLinesDownAction.when).toBe("textInputFocus && !editorReadonly");

        expect(duplicateSelectionAction.id).toBe("editor.action.duplicateSelection");
        expect(duplicateSelectionAction.title).toBe("Duplicate Selection");
        expect(duplicateSelectionAction.keybinding).toBeUndefined();
        expect(duplicateSelectionAction.when).toBe("textInputFocus && !editorReadonly");

        expect(deleteLinesAction.id).toBe("editor.action.deleteLines");
        expect(deleteLinesAction.title).toBe("Delete Line");
        expect(deleteLinesAction.keybinding).toEqual(parseKeybinding("ctrl+shift+k"));
        // Аккорд — единственный досягаемый на legacy-tier'е.
        expect(deleteLinesAction.keybindings).toEqual([
            { keys: parseChord("ctrl+k ctrl+k"), when: "tier == 'legacy'" },
        ]);
        expect(deleteLinesAction.when).toBe("textInputFocus && !editorReadonly");
    });

    it("no-op у края не кладёт элемент в undo-стек", async () => {
        const { editor, exec } = openEditor("a\nb");
        editor.viewState.selections = [createCursorSelection(0, 0)];

        await exec(moveLinesUpAction); // первая строка — двигать некуда
        expect(editor.getText()).toBe("a\nb");

        editor.undo(); // стек пуст — документ не меняется
        expect(editor.getText()).toBe("a\nb");
    });
});
