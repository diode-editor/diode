import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestEditorContextMenuController } from "../../../../TestUtils/testEditorContextMenu.ts";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { createCursorSelection } from "../../../editor/common/core/iSelection.ts";
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

import {
    cursorBottomAction,
    cursorBottomSelectAction,
    cursorDownAction,
    cursorDownSelectAction,
    cursorEndAction,
    cursorEndSelectAction,
    cursorHomeAction,
    cursorHomeSelectAction,
    cursorLeftAction,
    cursorLeftSelectAction,
    cursorPageDownAction,
    cursorPageDownSelectAction,
    cursorPageUpAction,
    cursorPageUpSelectAction,
    cursorRightAction,
    cursorRightSelectAction,
    cursorTopAction,
    cursorTopSelectAction,
    cursorUpAction,
    cursorUpSelectAction,
    cursorWordLeftAction,
    cursorWordLeftSelectAction,
    cursorWordRightAction,
    cursorWordRightSelectAction,
    scrollLineDownAction,
    scrollLineUpAction,
} from "./editorActions.ts";

// Line 0: "hello world", line 1: "second line", then "line 2".."line 29".
const CONTENT = ["hello world", "second line", ...Array.from({ length: 28 }, (_, i) => `line ${String(i + 2)}`)].join(
    "\n",
);

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

function openEditor(content: string = CONTENT) {
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
    function setCursor(line: number, character: number): void {
        editor!.viewState.selections = [createCursorSelection(line, character)];
    }
    return { ctrl, editor, exec, setCursor };
}

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "vexx-editor-actions-" });
});
afterEach(() => {
    ws.dispose();
});

describe("EditorActions — cursor movement moves the real cursor", () => {
    const cases: { action: CommandAction; from: [number, number]; to: [number, number] }[] = [
        { action: cursorLeftAction, from: [0, 3], to: [0, 2] },
        { action: cursorRightAction, from: [0, 3], to: [0, 4] },
        { action: cursorUpAction, from: [1, 3], to: [0, 3] },
        { action: cursorDownAction, from: [0, 3], to: [1, 3] },
        { action: cursorHomeAction, from: [0, 5], to: [0, 0] },
        { action: cursorEndAction, from: [0, 3], to: [0, 11] },
        { action: cursorTopAction, from: [2, 2], to: [0, 0] },
        { action: cursorBottomAction, from: [0, 0], to: [29, "line 29".length] },
        { action: cursorWordLeftAction, from: [0, 11], to: [0, 6] },
        { action: cursorWordRightAction, from: [0, 0], to: [0, 6] },
    ];

    for (const { action, from, to } of cases) {
        it(`${action.id}: (${from.join(",")}) -> (${to.join(",")})`, () => {
            const { editor, exec, setCursor } = openEditor();
            setCursor(from[0], from[1]);
            exec(action);
            expect(editor.viewState.selections[0].active).toEqual({ line: to[0], character: to[1] });
            // collapsed move: no selection
            expect(editor.viewState.selections[0].anchor).toEqual({ line: to[0], character: to[1] });
        });
    }
});

describe("EditorActions — select variants keep the anchor and extend to the new active", () => {
    const cases: { action: CommandAction; from: [number, number]; active: [number, number] }[] = [
        { action: cursorLeftSelectAction, from: [1, 3], active: [1, 2] },
        { action: cursorRightSelectAction, from: [1, 3], active: [1, 4] },
        { action: cursorUpSelectAction, from: [1, 3], active: [0, 3] },
        { action: cursorDownSelectAction, from: [1, 3], active: [2, 3] },
        { action: cursorHomeSelectAction, from: [1, 3], active: [1, 0] },
        { action: cursorEndSelectAction, from: [1, 3], active: [1, 11] },
        { action: cursorTopSelectAction, from: [1, 3], active: [0, 0] },
        { action: cursorWordRightSelectAction, from: [1, 0], active: [1, 7] },
        { action: cursorWordLeftSelectAction, from: [1, 6], active: [1, 0] },
    ];

    for (const { action, from, active } of cases) {
        it(`${action.id} extends selection from (${from.join(",")})`, () => {
            const { editor, exec, setCursor } = openEditor();
            setCursor(from[0], from[1]);
            exec(action);
            const sel = editor.viewState.selections[0];
            expect(sel.anchor).toEqual({ line: from[0], character: from[1] });
            expect(sel.active).toEqual({ line: active[0], character: active[1] });
        });
    }
});

describe("EditorActions — smart home", () => {
    it("cursorHome toggles between the first non-whitespace character and column 0", () => {
        const { editor, exec, setCursor } = openEditor("    indented");
        setCursor(0, 8);
        exec(cursorHomeAction); // from within the text → first non-ws
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 4 });
        exec(cursorHomeAction); // already at first non-ws → column 0
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 0 });
        exec(cursorHomeAction); // back to first non-ws
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 4 });
    });

    it("cursorHomeSelect extends the selection to the first non-whitespace character", () => {
        const { editor, exec, setCursor } = openEditor("    indented");
        setCursor(0, 8);
        exec(cursorHomeSelectAction);
        const sel = editor.viewState.selections[0];
        expect(sel.anchor).toEqual({ line: 0, character: 8 });
        expect(sel.active).toEqual({ line: 0, character: 4 });
    });
});

describe("EditorActions — page navigation", () => {
    it("cursorPageDown moves down by viewportHeight - 1", () => {
        const { editor, exec, setCursor } = openEditor();
        editor.viewState.viewportHeight = 10;
        setCursor(0, 0);
        exec(cursorPageDownAction);
        expect(editor.viewState.selections[0].active.line).toBe(9);
    });

    it("cursorPageUp moves up by viewportHeight - 1", () => {
        const { editor, exec, setCursor } = openEditor();
        editor.viewState.viewportHeight = 10;
        setCursor(20, 0);
        exec(cursorPageUpAction);
        expect(editor.viewState.selections[0].active.line).toBe(11);
    });

    it("cursorPageDownSelect extends selection downward", () => {
        const { editor, exec, setCursor } = openEditor();
        editor.viewState.viewportHeight = 10;
        setCursor(0, 0);
        exec(cursorPageDownSelectAction);
        expect(editor.viewState.selections[0].anchor).toEqual({ line: 0, character: 0 });
        expect(editor.viewState.selections[0].active.line).toBe(9);
    });

    it("cursorPageUpSelect extends selection upward", () => {
        const { editor, exec, setCursor } = openEditor();
        editor.viewState.viewportHeight = 10;
        setCursor(20, 0);
        exec(cursorPageUpSelectAction);
        expect(editor.viewState.selections[0].anchor).toEqual({ line: 20, character: 0 });
        expect(editor.viewState.selections[0].active.line).toBe(11);
    });
});

describe("EditorActions — scroll without moving the cursor", () => {
    it("scrollLineDown increases scrollTop by one", () => {
        const { editor, exec } = openEditor();
        editor.viewState.viewportHeight = 5;
        editor.viewState.scrollTop = 3;
        exec(scrollLineDownAction);
        expect(editor.viewState.scrollTop).toBe(4);
    });

    it("scrollLineUp decreases scrollTop by one", () => {
        const { editor, exec } = openEditor();
        editor.viewState.viewportHeight = 5;
        editor.viewState.scrollTop = 3;
        exec(scrollLineUpAction);
        expect(editor.viewState.scrollTop).toBe(2);
    });
});

describe("EditorActions — no active editor is a safe no-op", () => {
    it("does not throw when the group has no open editor", () => {
        const ctrl = createGroup();
        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => ctrl);
        registerAction(commands, keybindings, accessor, cursorRightAction);
        expect(() => commands.execute(cursorRightAction.id)).not.toThrow();
    });
});
