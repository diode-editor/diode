import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { createTestActiveEditorService } from "../../../../TestUtils/testActiveEditorService.ts";
import { createTestConfigurationService } from "../../../../TestUtils/testConfigurationService.ts";
import { createTestEditorContextMenuController } from "../../../../TestUtils/testEditorContextMenu.ts";
import { createEditorPane } from "../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../base/common/uri.ts";
import { createCursorSelection, createSelection } from "../../../editor/common/core/iSelection.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../editor/common/languages/tokenizationRegistry.ts";
import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { registerAction } from "../../../platform/actions/common/commandAction.ts";
import type { IClipboard } from "../../../platform/clipboard/common/iClipboard.ts";
import { ClipboardDIToken } from "../../../platform/clipboard/common/iClipboard.ts";
import { OscClipboard } from "../../../platform/clipboard/common/oscClipboard.ts";
import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { IConfigurationServiceDIToken } from "../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { NULL_FILE_WATCHER } from "../../../platform/files/common/iFileWatcher.ts";
import { Container } from "../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { NULL_LOG_SERVICE } from "../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";
import { EditorService } from "../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../services/editor/common/editorService.ts";
import { darkPlusTheme } from "../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../services/themes/common/themeService.ts";

import { clipboardCopyAction, clipboardCutAction, clipboardPasteAction } from "./clipboardActions.ts";

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

function openEditor(content: string, clipboard: IClipboard, emptySelectionClipboard = true) {
    const editor = createEditorPane();
    editor.openFile(Uri.file(ws.writeFile("doc.txt", content)));
    const ctrl = createTestActiveEditorService(editor);

    const commands = new CommandRegistry();
    const accessor = new Container();
    accessor.bind(EditorServiceDIToken, () => ctrl);
    accessor.bind(ClipboardDIToken, () => clipboard);
    accessor.bind(IConfigurationServiceDIToken, () =>
        createTestConfigurationService({ "editor.emptySelectionClipboard": emptySelectionClipboard }),
    );

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

    it("leaves the clipboard alone without an open pane", async () => {
        const clipboard = memoryClipboard("previous");
        const ctrl = createTestActiveEditorService(null); // no open tabs
        const commands = new CommandRegistry();
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => ctrl);
        accessor.bind(ClipboardDIToken, () => clipboard);
        registerAction(commands, new KeybindingRegistry(), accessor, clipboardCopyAction);

        await commands.execute(clipboardCopyAction.id);

        // Were a non-empty stub in place of the empty list, the clipboard would get overwritten with unselected text.
        expect(await clipboard.readText()).toBe("previous");
    });

    it("an empty selection copies the whole line (emptySelectionClipboard)", async () => {
        const clipboard = memoryClipboard("previous");
        const { editor, exec } = openEditor("hello world\nsecond", clipboard);
        editor.viewState.selections = [createCursorSelection(0, 3)];

        await exec(clipboardCopyAction);

        expect(await clipboard.readText()).toBe("hello world\n");
        expect(editor.getText()).toBe("hello world\nsecond");
    });

    it("with emptySelectionClipboard off, an empty selection leaves the clipboard alone", async () => {
        const clipboard = memoryClipboard("previous");
        const { editor, exec } = openEditor("hello world", clipboard, false);
        editor.viewState.selections = [createCursorSelection(0, 3)];

        await exec(clipboardCopyAction);

        expect(await clipboard.readText()).toBe("previous");
    });

    it("setting not set at all — default true applies, the line is copied", async () => {
        const clipboard = memoryClipboard();
        const editor = createEditorPane();
        editor.openFile(Uri.file(ws.writeFile("doc.txt", "hello world")));
        const ctrl = createTestActiveEditorService(editor);
        editor.viewState.selections = [createCursorSelection(0, 3)];
        const commands = new CommandRegistry();
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => ctrl);
        accessor.bind(ClipboardDIToken, () => clipboard);
        // The NULL service returns undefined, so the `?? true` default must kick in.
        accessor.bind(IConfigurationServiceDIToken, () => createTestConfigurationService());
        registerAction(commands, new KeybindingRegistry(), accessor, clipboardCopyAction);

        await commands.execute(clipboardCopyAction.id);

        expect(await clipboard.readText()).toBe("hello world\n");
    });

    it("joins multi-cursor selections with a newline", async () => {
        const clipboard = memoryClipboard();
        const { editor, exec } = openEditor("alpha beta", clipboard);
        editor.viewState.selections = [createSelection(0, 0, 0, 5), createSelection(0, 6, 0, 10)];

        await exec(clipboardCopyAction);

        expect(await clipboard.readText()).toBe("alpha\nbeta");
    });

    it("collapsed cursors add no empty lines", async () => {
        const clipboard = memoryClipboard();
        const { editor, exec } = openEditor("alpha beta", clipboard);
        editor.viewState.selections = [createSelection(0, 0, 0, 5), createCursorSelection(0, 8)];

        await exec(clipboardCopyAction);

        expect(await clipboard.readText()).toBe("alpha");
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

    it("an empty selection cuts the whole line (emptySelectionClipboard)", async () => {
        const clipboard = memoryClipboard();
        const { editor, exec } = openEditor("first\nsecond", clipboard);
        editor.viewState.selections = [createCursorSelection(0, 3)];

        await exec(clipboardCutAction);

        expect(await clipboard.readText()).toBe("first\n");
        expect(editor.getText()).toBe("second");
    });

    it("with emptySelectionClipboard off, an empty selection cuts nothing", async () => {
        const clipboard = memoryClipboard("previous");
        const { editor, exec } = openEditor("hello world", clipboard, false);
        editor.viewState.selections = [createCursorSelection(0, 3)];

        await exec(clipboardCutAction);

        expect(await clipboard.readText()).toBe("previous");
        expect(editor.getText()).toBe("hello world");
    });

    it("with multiple cursors, copies exactly what it deletes", async () => {
        // Regression: Cut took the text of the primary selection only but deleted all selections.
        const clipboard = memoryClipboard();
        const { editor, exec } = openEditor("alpha beta gamma", clipboard);
        editor.viewState.selections = [createSelection(0, 0, 0, 6), createSelection(0, 11, 0, 16)];

        await exec(clipboardCutAction);

        expect(await clipboard.readText()).toBe("alpha \ngamma");
        expect(editor.getText()).toBe("beta ");
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
        // The early exit must happen BEFORE the edit: otherwise an empty paste bumps the
        // document version and dirties the buffer (a "dirty" tab with no changes).
        expect(editor.isModified).toBe(false);
    });
});

describe("clipboardCutAction defensive delete handling", () => {
    it("still copies to the clipboard but pushes no undo when the delete is a no-op", async () => {
        // A real editor with a selection always yields undo; the stub forces pushUndo(undefined).
        const clipboard = memoryClipboard();
        const pushUndo = vi.fn();
        const editor = {
            viewState: {
                getTextToCopy: () => ({ text: "selected", isFromEmptySelection: false }),
                cutSelections: () => undefined,
            },
            pushUndo,
        };
        const commands = new CommandRegistry();
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => ({ getActiveEditor: () => editor }) as never);
        accessor.bind(ClipboardDIToken, () => clipboard);
        accessor.bind(IConfigurationServiceDIToken, () => createTestConfigurationService());

        registerAction(commands, new KeybindingRegistry(), accessor, clipboardCutAction);
        await commands.execute(clipboardCutAction.id);

        expect(await clipboard.readText()).toBe("selected");
        expect(pushUndo).toHaveBeenCalledWith(undefined);
    });
});

describe("full-line paste of a line copied with an empty selection", () => {
    it("copy without a selection → paste puts the line above the cursor line, the cursor stays with the text", async () => {
        const clipboard = memoryClipboard();
        const { editor, exec } = openEditor("first\nsecond\nthird", clipboard);
        editor.viewState.selections = [createCursorSelection(0, 2)];
        await exec(clipboardCopyAction);

        editor.viewState.selections = [createCursorSelection(2, 3)];
        await exec(clipboardPasteAction);

        expect(editor.getText()).toBe("first\nsecond\nfirst\nthird");
        expect(editor.viewState.selections[0].active).toEqual({ line: 3, character: 3 });
    });

    it("cut with an empty selection → paste restores the line above the cursor line", async () => {
        const clipboard = memoryClipboard();
        const { editor, exec } = openEditor("first\nsecond", clipboard);
        editor.viewState.selections = [createCursorSelection(0, 0)];
        await exec(clipboardCutAction);
        expect(editor.getText()).toBe("second");

        // The cursor is not in column zero: a regular paste would split the word, and
        // only a line paste puts the whole line above the cursor line.
        editor.viewState.selections = [createCursorSelection(0, 3)];
        await exec(clipboardPasteAction);
        expect(editor.getText()).toBe("first\nsecond");
        expect(editor.viewState.selections[0].active).toEqual({ line: 1, character: 3 });
    });

    it("a line copied with a NON-empty selection is pasted at the cursor position", async () => {
        const clipboard = memoryClipboard();
        const { editor, exec } = openEditor("first\nsecond", clipboard);
        editor.viewState.selections = [createSelection(0, 0, 1, 0)]; // the whole "first\n"
        await exec(clipboardCopyAction);

        editor.viewState.selections = [createCursorSelection(1, 3)];
        await exec(clipboardPasteAction);

        expect(editor.getText()).toBe("first\nsecfirst\nond");
    });

    it("the same text written to the clipboard bypassing copy is pasted as usual", async () => {
        const clipboard = memoryClipboard("stranger\n");
        const { editor, exec } = openEditor("ab", clipboard);
        editor.viewState.selections = [createCursorSelection(0, 1)];

        await exec(clipboardPasteAction);

        expect(editor.getText()).toBe("astranger\nb");
    });

    it("with emptySelectionClipboard off, there is no full-line paste", async () => {
        const clipboard = memoryClipboard();
        const first = openEditor("line\nrest", clipboard);
        first.editor.viewState.selections = [createCursorSelection(0, 0)];
        await first.exec(clipboardCopyAction);

        const second = openEditor("ab", clipboard, false);
        second.editor.viewState.selections = [createCursorSelection(0, 1)];
        await second.exec(clipboardPasteAction);

        expect(second.editor.getText()).toBe("aline\nb");
    });
});

describe("copy→paste round-trip via OscClipboard (internal register)", () => {
    it("pastes copied text instantly through the internal register, never querying the terminal", async () => {
        // Paste must not send an OSC 52 read request (`\x1b]52;c;?\x07`): it hangs in kitty+ssh+tmux.
        const writeFn = vi.fn();
        const clipboard = new OscClipboard(writeFn);
        const { editor, exec } = openEditor("hello world", clipboard);

        editor.viewState.selections = [createSelection(0, 0, 0, 5)]; // "hello"
        await exec(clipboardCopyAction);

        editor.viewState.selections = [createCursorSelection(0, 11)]; // end of line
        await exec(clipboardPasteAction);

        expect(editor.getText()).toBe("hello worldhello");
        expect(writeFn).toHaveBeenCalledOnce();
        expect(writeFn.mock.calls[0][0]).not.toContain("?");
    });
});

describe("clipboard actions without an active editor", () => {
    it("are safe no-ops", async () => {
        const ctrl = createTestActiveEditorService(null);
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
