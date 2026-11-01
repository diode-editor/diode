import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../../TestUtils/testConfigurationService.ts";
import { createTestEditorContextMenuController } from "../../../../TestUtils/testEditorContextMenu.ts";
import { createCursorSelection } from "../../../editor/common/core/iSelection.ts";
import type { CodeLensCommand } from "../../../editor/common/languages/iCodeLensSource.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../editor/common/languages/tokenizationRegistry.ts";
import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { registerAction } from "../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../platform/commands/common/commandRegistry.ts";
import { NULL_FILE_WATCHER } from "../../../platform/files/common/iFileWatcher.ts";
import { Container } from "../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry, parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { NULL_LOG_SERVICE } from "../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";
import { EditorService } from "../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../services/editor/common/editorService.ts";
import { NotificationServiceDIToken } from "../../services/notification/browser/notificationService.ts";
import { darkPlusTheme } from "../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../services/themes/common/themeService.ts";
import { QuickInputServiceDIToken } from "../parts/quickinput/quickInputService.ts";

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
    cursorLineEndAction,
    cursorLineStartAction,
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
    showLensesInCurrentLineAction,
    toggleInlayHintsAction,
    toggleWordWrapAction,
} from "./editorActions.ts";

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
        createTestConfigurationService(),
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
        NULL_LOG_SERVICE,
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
    ws = createTempWorkspace({ prefix: "diode-editor-actions-" });
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

describe("EditorActions — line start / end (mac Ctrl+A / Ctrl+E)", () => {
    it("ids and titles as in VS Code, no own pc keybindings (mac keybindings live in the delta table)", () => {
        expect([cursorLineStartAction.id, cursorLineStartAction.title]).toEqual([
            "cursorLineStart",
            "Cursor Line Start",
        ]);
        expect([cursorLineEndAction.id, cursorLineEndAction.title]).toEqual(["cursorLineEnd", "Cursor Line End"]);
        expect(cursorLineStartAction.keybinding).toBeUndefined();
        expect(cursorLineEndAction.keybinding).toBeUndefined();
    });

    it("cursorLineStart goes to column 0 past the indentation, cursorLineEnd to the line end", () => {
        const { editor, exec, setCursor } = openEditor("    indented");
        setCursor(0, 8);
        exec(cursorLineStartAction);
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 0 });
        exec(cursorLineEndAction);
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 12 });
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

describe("EditorActions — View: Toggle Word Wrap", () => {
    it("the command toggles word wrap of the active editor back and forth", () => {
        const { editor, exec } = openEditor();
        expect(editor.viewState.wordWrap).toBe("off");
        exec(toggleWordWrapAction);
        expect(editor.viewState.wordWrap).toBe("on");
        exec(toggleWordWrapAction);
        expect(editor.viewState.wordWrap).toBe("off");
    });

    it("command metadata: id, command palette title and the Alt+Z keybinding", () => {
        expect(toggleWordWrapAction.id).toBe("editor.action.toggleWordWrap");
        expect(toggleWordWrapAction.title).toBe("View: Toggle Word Wrap");
        expect(toggleWordWrapAction.keybinding).toEqual(parseKeybinding("alt+z"));
    });
});

describe("EditorActions — toggle inlay hints", () => {
    it("command metadata: our id, the palette title, focus gate, no default key", () => {
        expect(toggleInlayHintsAction.id).toBe("diode.editor.inlayHints.toggle");
        expect(toggleInlayHintsAction.title).toBe("Toggle Inlay Hints");
        expect(toggleInlayHintsAction.when).toBe("textInputFocus");
        expect(toggleInlayHintsAction.keybinding).toBeUndefined();
    });

    it("hides the hints of the active editor and shows them back", () => {
        const { editor, exec } = openEditor();
        const spy = vi.spyOn(editor, "setInlayHints");
        exec(toggleInlayHintsAction);
        expect(spy.mock.lastCall?.[0].enabled).toBe(false);
        exec(toggleInlayHintsAction);
        expect(spy.mock.lastCall?.[0].enabled).toBe(true);
    });
});

describe("EditorActions — no active editor is a safe no-op", () => {
    it("does not throw when the group has no open editor", () => {
        const ctrl = createGroup();
        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => ctrl);
        for (const action of [cursorRightAction, cursorLineStartAction, cursorLineEndAction, toggleInlayHintsAction]) {
            registerAction(commands, keybindings, accessor, action);
            expect(() => commands.execute(action.id)).not.toThrow();
        }
    });
});

describe("EditorActions — show lenses of the current line", () => {
    const RUN = { id: "cmd.run", title: "Run", arguments: [1] };

    function setup(commandsAtLine: readonly CodeLensCommand[], pick: (items: readonly unknown[]) => unknown) {
        const picks = commandsAtLine.map((command) => ({ label: command.title, command }));
        const { ctrl, editor } = openEditor();
        const lines: number[] = [];
        vi.spyOn(editor, "getCodeLensPicksAtLine").mockImplementation((line) => {
            lines.push(line);
            return Promise.resolve(picks);
        });
        const quickPick = vi.fn((options: { items: readonly unknown[] }) => Promise.resolve(pick(options.items)));
        const commands = new CommandRegistry();
        const handler = vi.fn();
        commands.register("cmd.run", handler);
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => ctrl);
        accessor.bind(QuickInputServiceDIToken, () => ({ quickPick }) as never);
        accessor.bind(CommandRegistryDIToken, () => commands);
        accessor.bind(NotificationServiceDIToken, () => ({ show: vi.fn() }) as never);
        return { editor, lines, quickPick, handler, accessor };
    }

    it("command metadata as upstream: id, title, gate, no key", () => {
        expect(showLensesInCurrentLineAction.id).toBe("codelens.showLensesInCurrentLine");
        expect(showLensesInCurrentLineAction.title).toBe("Show CodeLens Commands for Current Line");
        expect(showLensesInCurrentLineAction.when).toBe("textInputFocus && editorHasCodeLensProvider");
        expect(showLensesInCurrentLineAction.keybinding).toBeUndefined();
    });

    it("offers the titles of the caret line and runs the picked command with its arguments", async () => {
        const { editor, lines, quickPick, handler, accessor } = setup([RUN], (items) => items[0]);
        editor.viewState.goToPosition(1, 0);
        await showLensesInCurrentLineAction.run(accessor);
        expect(lines).toEqual([1]);
        expect(quickPick).toHaveBeenCalledWith({
            placeholder: "Select a command",
            items: [{ label: "Run", command: RUN }],
        });
        expect(handler).toHaveBeenCalledWith(1);
    });

    it("no lenses: no picker", async () => {
        const { quickPick, accessor } = setup([], () => undefined);
        await showLensesInCurrentLineAction.run(accessor);
        expect(quickPick).not.toHaveBeenCalled();
    });

    it("the picker dismissed: nothing runs", async () => {
        const { handler, accessor } = setup([RUN], () => undefined);
        await showLensesInCurrentLineAction.run(accessor);
        expect(handler).not.toHaveBeenCalled();
    });

    it("no active editor: a safe no-op", async () => {
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => createGroup());
        await expect(showLensesInCurrentLineAction.run(accessor)).resolves.toBeUndefined();
    });
});
