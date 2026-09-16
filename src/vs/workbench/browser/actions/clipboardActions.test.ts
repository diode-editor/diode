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
import { IConfigurationServiceDIToken } from "../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
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

function openEditor(content: string, clipboard: IClipboard, emptySelectionClipboard = true) {
    const ctrl = createGroup();
    const filePath = ws.writeFile("doc.txt", content);
    ctrl.openFile(filePath);
    const editor = ctrl.getActiveEditor();
    if (editor === null) throw new Error("no active editor");

    const commands = new CommandRegistry();
    const accessor = new Container();
    accessor.bind(EditorServiceDIToken, () => ctrl);
    accessor.bind(ClipboardDIToken, () => clipboard);
    accessor.bind(IConfigurationServiceDIToken, () => ({
        ...NULL_CONFIGURATION_SERVICE,
        get: <T>(key: string, defaultValue?: T): T | undefined =>
            key === "editor.emptySelectionClipboard" ? (emptySelectionClipboard as T) : defaultValue,
    }));

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

    it("без открытой панели буфер обмена не трогает", async () => {
        const clipboard = memoryClipboard("прежнее");
        const ctrl = createGroup(); // ни одной открытой вкладки
        const commands = new CommandRegistry();
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => ctrl);
        accessor.bind(ClipboardDIToken, () => clipboard);
        registerAction(commands, new KeybindingRegistry(), accessor, clipboardCopyAction);

        await commands.execute(clipboardCopyAction.id);

        // Копировать нечего. Окажись на месте пустого списка непустая заглушка —
        // буфер затёрло бы текстом, которого пользователь не выделял.
        expect(await clipboard.readText()).toBe("прежнее");
    });

    it("пустое выделение копирует строку целиком (emptySelectionClipboard)", async () => {
        const clipboard = memoryClipboard("previous");
        const { editor, exec } = openEditor("hello world\nsecond", clipboard);
        editor.viewState.selections = [createCursorSelection(0, 3)];

        await exec(clipboardCopyAction);

        expect(await clipboard.readText()).toBe("hello world\n");
        expect(editor.getText()).toBe("hello world\nsecond");
    });

    it("при выключенном emptySelectionClipboard пустое выделение не трогает буфер", async () => {
        const clipboard = memoryClipboard("previous");
        const { editor, exec } = openEditor("hello world", clipboard, false);
        editor.viewState.selections = [createCursorSelection(0, 3)];

        await exec(clipboardCopyAction);

        expect(await clipboard.readText()).toBe("previous");
    });

    it("склеивает выделения мультикурсора через перевод строки", async () => {
        const clipboard = memoryClipboard();
        const { editor, exec } = openEditor("alpha beta", clipboard);
        editor.viewState.selections = [createSelection(0, 0, 0, 5), createSelection(0, 6, 0, 10)];

        await exec(clipboardCopyAction);

        expect(await clipboard.readText()).toBe("alpha\nbeta");
    });

    it("схлопнутые каретки не добавляют пустых строк", async () => {
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

    it("пустое выделение вырезает строку целиком (emptySelectionClipboard)", async () => {
        const clipboard = memoryClipboard();
        const { editor, exec } = openEditor("first\nsecond", clipboard);
        editor.viewState.selections = [createCursorSelection(0, 3)];

        await exec(clipboardCutAction);

        expect(await clipboard.readText()).toBe("first\n");
        expect(editor.getText()).toBe("second");
    });

    it("при выключенном emptySelectionClipboard пустое выделение не режет ничего", async () => {
        const clipboard = memoryClipboard("previous");
        const { editor, exec } = openEditor("hello world", clipboard, false);
        editor.viewState.selections = [createCursorSelection(0, 3)];

        await exec(clipboardCutAction);

        expect(await clipboard.readText()).toBe("previous");
        expect(editor.getText()).toBe("hello world");
    });

    it("в мультикурсоре копирует ровно то, что удаляет", async () => {
        // Регрессия: раньше Cut брал текст только первичного выделения, а удалял все —
        // второе выделение исчезало из документа, не попав в буфер.
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
    });
});

describe("clipboardCutAction defensive delete handling", () => {
    it("still copies to the clipboard but pushes no undo when the delete is a no-op", async () => {
        // A real editor with a non-empty selection always produces an undo on
        // cutSelections(); this stub forces pushUndo(undefined) — pane guards it.
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
        accessor.bind(IConfigurationServiceDIToken, () => NULL_CONFIGURATION_SERVICE);

        registerAction(commands, new KeybindingRegistry(), accessor, clipboardCutAction);
        await commands.execute(clipboardCutAction.id);

        expect(await clipboard.readText()).toBe("selected");
        expect(pushUndo).toHaveBeenCalledWith(undefined);
    });
});

describe("линейная вставка строки, скопированной пустым выделением", () => {
    it("copy без выделения → paste кладёт строку выше курсорной, каретка остаётся у текста", async () => {
        const clipboard = memoryClipboard();
        const { editor, exec } = openEditor("first\nsecond\nthird", clipboard);
        editor.viewState.selections = [createCursorSelection(0, 2)];
        await exec(clipboardCopyAction);

        editor.viewState.selections = [createCursorSelection(2, 3)];
        await exec(clipboardPasteAction);

        expect(editor.getText()).toBe("first\nsecond\nfirst\nthird");
        expect(editor.viewState.selections[0].active).toEqual({ line: 3, character: 3 });
    });

    it("cut пустым выделением → paste восстанавливает строку выше курсорной", async () => {
        const clipboard = memoryClipboard();
        const { editor, exec } = openEditor("first\nsecond", clipboard);
        editor.viewState.selections = [createCursorSelection(0, 0)];
        await exec(clipboardCutAction);
        expect(editor.getText()).toBe("second");

        await exec(clipboardPasteAction);
        expect(editor.getText()).toBe("first\nsecond");
    });

    it("тот же текст, записанный в буфер мимо copy, вставляется как обычно", async () => {
        const clipboard = memoryClipboard("stranger\n");
        const { editor, exec } = openEditor("ab", clipboard);
        editor.viewState.selections = [createCursorSelection(0, 1)];

        await exec(clipboardPasteAction);

        // Метаданных о линейности нет — текст ложится в позицию каретки.
        expect(editor.getText()).toBe("astranger\nb");
    });

    it("при выключенном emptySelectionClipboard линейной вставки нет", async () => {
        const clipboard = memoryClipboard();
        // Копируем с включённой настройкой, вставляем с выключенной.
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
