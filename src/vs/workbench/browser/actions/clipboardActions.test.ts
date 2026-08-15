import { NULL_LOG_SERVICE } from "../../../platform/log/common/nullLogService.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { createTestEditorContextMenuController } from "../../../../TestUtils/testEditorContextMenu.ts";
import { createCursorSelection, createSelection } from "../../../editor/common/core/iSelection.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../editor/common/languages/tokenizationRegistry.ts";
import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { registerAction } from "../../../platform/actions/common/commandAction.ts";
import type { IClipboard } from "../../../platform/clipboard/common/iClipboard.ts";
import { OscClipboard } from "../../../platform/clipboard/common/oscClipboard.ts";
import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../platform/files/common/iFileWatcher.ts";
import { Container } from "../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { WorkbenchTheme } from "../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";
import { ClipboardDIToken } from "../../common/coreTokens.ts";
import { EditorService, EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";
import { darkPlusTheme } from "../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../services/themes/common/themeService.ts";

import { clipboardCopyAction, clipboardCutAction, clipboardPasteAction } from "./clipboardActions.ts";

/** A real (in-memory) clipboard — not a spy. */
function memoryClipboard(initial = ""): IClipboard {
    let text = initial;
    return {
        readText: () => Promise.resolve(text),
        writeText: (value: string) => {
            text = value;
            return Promise.resolve();
        },
    };
}

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
        NULL_LOG_SERVICE,
    );
}

function openEditor(content: string, clipboard: IClipboard) {
    const ctrl = createGroup();
    const filePath = ws.writeFile("doc.txt", content);
    ctrl.openFile(filePath);
    const editor = ctrl.getActiveEditor();
    if (editor === null) throw new Error("no active editor");

    const commands = new CommandRegistry();
    const accessor = new Container();
    accessor.bind(EditorServiceDIToken, () => ctrl);
    accessor.bind(ClipboardDIToken, () => clipboard);

    async function exec(action: CommandAction): Promise<void> {
        registerAction(commands, new KeybindingRegistry(), accessor, action);
        await commands.execute(action.id);
    }
    return { ctrl, editor, exec };
}

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-clipboard-actions-" });
});
afterEach(() => {
    ws.dispose();
});

describe("clipboardCopyAction", () => {
    it("copies the selected text to the clipboard without changing the document", async () => {
        const clipboard = memoryClipboard();
        const { editor, exec } = openEditor("hello world", clipboard);
        editor.viewState.selections = [createSelection(0, 0, 0, 5)]; // "hello"

        await exec(clipboardCopyAction);

        expect(await clipboard.readText()).toBe("hello");
        expect(editor.getText()).toBe("hello world");
    });

    it("leaves the clipboard untouched when nothing is selected", async () => {
        const clipboard = memoryClipboard("previous");
        const { editor, exec } = openEditor("hello world", clipboard);
        editor.viewState.selections = [createCursorSelection(0, 3)];

        await exec(clipboardCopyAction);

        expect(await clipboard.readText()).toBe("previous");
    });
});

describe("clipboardCutAction", () => {
    it("copies the selection and removes it from the document", async () => {
        const clipboard = memoryClipboard();
        const { editor, exec } = openEditor("hello world", clipboard);
        editor.viewState.selections = [createSelection(0, 0, 0, 6)]; // "hello "

        await exec(clipboardCutAction);

        expect(await clipboard.readText()).toBe("hello ");
        expect(editor.getText()).toBe("world");
    });

    it("does nothing when the selection is empty", async () => {
        const clipboard = memoryClipboard("previous");
        const { editor, exec } = openEditor("hello world", clipboard);
        editor.viewState.selections = [createCursorSelection(0, 3)];

        await exec(clipboardCutAction);

        expect(await clipboard.readText()).toBe("previous");
        expect(editor.getText()).toBe("hello world");
    });
});

describe("clipboardPasteAction", () => {
    it("inserts the clipboard text at the cursor", async () => {
        const clipboard = memoryClipboard("XYZ");
        const { editor, exec } = openEditor("hello world", clipboard);
        editor.viewState.selections = [createCursorSelection(0, 5)];

        await exec(clipboardPasteAction);

        expect(editor.getText()).toBe("helloXYZ world");
    });

    it("replaces the active selection with the clipboard text", async () => {
        const clipboard = memoryClipboard("XYZ");
        const { editor, exec } = openEditor("hello world", clipboard);
        editor.viewState.selections = [createSelection(0, 0, 0, 5)]; // "hello"

        await exec(clipboardPasteAction);

        expect(editor.getText()).toBe("XYZ world");
    });

    it("does nothing when the clipboard is empty", async () => {
        const clipboard = memoryClipboard("");
        const { editor, exec } = openEditor("hello world", clipboard);
        editor.viewState.selections = [createCursorSelection(0, 5)];

        await exec(clipboardPasteAction);

        expect(editor.getText()).toBe("hello world");
    });
});

describe("clipboardCutAction defensive delete handling", () => {
    it("still copies to the clipboard but pushes no undo when the delete is a no-op", async () => {
        // A real editor with a non-empty selection always produces an undo on
        // deleteLeft(); this stub forces the defensive `if (undo)` false branch.
        const clipboard = memoryClipboard();
        const pushUndo = vi.fn();
        const editor = {
            viewState: {
                getSelectedText: () => "selected",
                deleteLeft: () => undefined,
            },
            pushUndo,
        };
        const commands = new CommandRegistry();
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => ({ getActiveEditor: () => editor }) as never);
        accessor.bind(ClipboardDIToken, () => clipboard);

        registerAction(commands, new KeybindingRegistry(), accessor, clipboardCutAction);
        await commands.execute(clipboardCutAction.id);

        expect(await clipboard.readText()).toBe("selected");
        expect(pushUndo).not.toHaveBeenCalled();
    });
});

describe("copy→paste round-trip via OscClipboard (internal register)", () => {
    it("pastes copied text instantly through the internal register, never querying the terminal", async () => {
        // Real OscClipboard: copy must mirror out via the OSC 52 *write* sequence, and a
        // subsequent paste must read back the register without emitting an OSC 52 read
        // query (`\x1b]52;c;?\x07`) — the round-trip that hangs in kitty+ssh+tmux.
        const writeFn = vi.fn();
        const clipboard = new OscClipboard(writeFn);
        const { editor, exec } = openEditor("hello world", clipboard);

        editor.viewState.selections = [createSelection(0, 0, 0, 5)]; // "hello"
        await exec(clipboardCopyAction);

        editor.viewState.selections = [createCursorSelection(0, 11)]; // end of line
        await exec(clipboardPasteAction);

        expect(editor.getText()).toBe("hello worldhello");
        // The only sequence ever written is the OSC 52 write from copy — no read query.
        expect(writeFn).toHaveBeenCalledOnce();
        expect(writeFn.mock.calls[0][0]).not.toContain("?");
    });
});

describe("clipboard actions without an active editor", () => {
    it("are safe no-ops", async () => {
        const ctrl = createGroup();
        const clipboard = memoryClipboard("data");
        const commands = new CommandRegistry();
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => ctrl);
        accessor.bind(ClipboardDIToken, () => clipboard);
        for (const action of [clipboardCopyAction, clipboardCutAction, clipboardPasteAction]) {
            registerAction(commands, new KeybindingRegistry(), accessor, action);
            await expect(commands.execute(action.id)).resolves.not.toThrow();
        }
    });
});
