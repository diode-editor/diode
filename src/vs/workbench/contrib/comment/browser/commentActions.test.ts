import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestActiveEditorService } from "../../../../../TestUtils/testActiveEditorService.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createCursorSelection, createSelection } from "../../../../editor/common/core/iSelection.ts";
import type { ILanguageConfigurationService } from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import {
    LanguageConfigurationServiceDIToken,
    NULL_LANGUAGE_CONFIGURATION_SERVICE,
} from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import {
    EMPTY_LANGUAGE_CONFIGURATION,
    type IResolvedLanguageConfiguration,
} from "../../../../editor/common/languages/languageConfiguration.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    KeybindingRegistry,
    parseChord,
    parseKeybinding,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import {
    addCommentLineAction,
    blockCommentAction,
    commentLineAction,
    removeCommentLineAction,
} from "./commentActions.ts";

const TS_CONFIGURATION: IResolvedLanguageConfiguration = {
    ...EMPTY_LANGUAGE_CONFIGURATION,
    comments: { lineComment: "//", blockComment: ["/*", "*/"] },
};

let ws: ITempWorkspace;

function fixedConfiguration(configuration: IResolvedLanguageConfiguration): ILanguageConfigurationService {
    return {
        ...NULL_LANGUAGE_CONFIGURATION_SERVICE,
        get: () => configuration,
        ensureLoaded: () => Promise.resolve(configuration),
    };
}

function openEditor(content: string, languages: ILanguageConfigurationService = fixedConfiguration(TS_CONFIGURATION)) {
    const editor = createEditorPane();
    editor.openFile(Uri.file(ws.writeFile("doc.txt", content)));
    const ctrl = createTestActiveEditorService(editor);

    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry();
    const accessor = new Container();
    accessor.bind(EditorServiceDIToken, () => ctrl);
    accessor.bind(LanguageConfigurationServiceDIToken, () => languages);

    async function exec(action: CommandAction): Promise<void> {
        registerAction(commands, keybindings, accessor, action);
        await commands.execute(action.id);
    }
    return { ctrl, editor, exec };
}

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-comment-actions-" });
});
afterEach(() => {
    ws.dispose();
});

describe("commentActions — ids and keybindings as in VS Code", () => {
    it("command IDs and keys match the stock ones", () => {
        expect(commentLineAction.id).toBe("editor.action.commentLine");
        expect(commentLineAction.keybinding).toEqual(parseKeybinding("mod+/"));
        expect(addCommentLineAction.id).toBe("editor.action.addCommentLine");
        expect(addCommentLineAction.keybinding).toEqual(parseChord("mod+k mod+c"));
        expect(removeCommentLineAction.id).toBe("editor.action.removeCommentLine");
        expect(removeCommentLineAction.keybinding).toEqual(parseChord("mod+k mod+u"));
        expect(blockCommentAction.id).toBe("editor.action.blockComment");
        expect(blockCommentAction.keybinding).toEqual(parseChord("ctrl+k alt+a"));
        expect(blockCommentAction.keybindings).toEqual([
            { keys: parseKeybinding("shift+alt+a"), when: "tier != 'legacy'" },
        ]);
        for (const action of [commentLineAction, addCommentLineAction, removeCommentLineAction, blockCommentAction]) {
            expect(action.when).toBe("textInputFocus && !editorReadonly");
        }
    });
});

describe("commentActions — execution on the active editor", () => {
    it("commentLine toggles the cursor line with the language token", async () => {
        const { editor, exec } = openEditor("const a = 1;");
        editor.viewState.selections = [createCursorSelection(0, 0)];
        await exec(commentLineAction);
        expect(editor.getText()).toBe("// const a = 1;");
        await exec(commentLineAction);
        expect(editor.getText()).toBe("const a = 1;");
    });

    it("commentLine pushes a step onto the editor undo", async () => {
        const { editor, exec } = openEditor("aaa");
        await exec(commentLineAction);
        expect(editor.getText()).toBe("// aaa");
        editor.undo();
        expect(editor.getText()).toBe("aaa");
    });

    it("add/remove act unconditionally, regardless of the line state", async () => {
        const { editor, exec } = openEditor("// aaa");
        await exec(addCommentLineAction);
        expect(editor.getText()).toBe("// // aaa");
        await exec(removeCommentLineAction);
        expect(editor.getText()).toBe("// aaa");
    });

    it("blockComment wraps the selection", async () => {
        const { editor, exec } = openEditor("const a = 1;");
        editor.viewState.selections = [createSelection(0, 6, 0, 7)];
        await exec(blockCommentAction);
        expect(editor.getText()).toBe("const /* a */ = 1;");
    });

    it("a language without a comments section is a no-op", async () => {
        const { editor, exec } = openEditor("aaa", fixedConfiguration(EMPTY_LANGUAGE_CONFIGURATION));
        await exec(commentLineAction);
        expect(editor.getText()).toBe("aaa");
    });

    it("without an active editor: a safe no-op", async () => {
        const ctrl = createTestActiveEditorService(null);
        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => ctrl);
        accessor.bind(LanguageConfigurationServiceDIToken, () => fixedConfiguration(TS_CONFIGURATION));
        for (const action of [commentLineAction, addCommentLineAction, removeCommentLineAction, blockCommentAction]) {
            registerAction(commands, keybindings, accessor, action);
            await commands.execute(action.id);
        }
    });

    it("a document REPLACED while the configuration was loading is not edited after the fact", async () => {
        // Reloading the file from disk recreates the document and the editor view state.
        // A fresh document has its own version that may match the captured one, so
        // the command checks not only the version but the document itself.
        const reloaded = new EditorViewState(new TextDocument("reloaded"));
        const original = new EditorViewState(new TextDocument("original"));
        const stub = { viewState: original, pushUndo: () => undefined };

        let release: (value: IResolvedLanguageConfiguration) => void = () => undefined;
        const gate = new Promise<IResolvedLanguageConfiguration>((resolve) => {
            release = resolve;
        });

        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => ({ getActiveEditor: () => stub }) as unknown as EditorService);
        accessor.bind(LanguageConfigurationServiceDIToken, () => ({
            ...NULL_LANGUAGE_CONFIGURATION_SERVICE,
            get: () => undefined,
            ensureLoaded: () => gate,
        }));

        registerAction(commands, keybindings, accessor, commentLineAction);
        const pending = commands.execute(commentLineAction.id);
        stub.viewState = reloaded;
        release(TS_CONFIGURATION);
        await pending;

        expect(reloaded.document.getText()).toBe("reloaded");
        expect(original.document.getText()).toBe("original");
    });

    it("a document changed WHILE the configuration was loading is not edited after the fact", async () => {
        const { editor, exec } = openEditor("aaa");
        let release: (value: IResolvedLanguageConfiguration) => void = () => undefined;
        const gate = new Promise<IResolvedLanguageConfiguration>((resolve) => {
            release = resolve;
        });
        const slow: ILanguageConfigurationService = {
            ...NULL_LANGUAGE_CONFIGURATION_SERVICE,
            get: () => undefined,
            ensureLoaded: () => gate,
        };
        const { editor: slowEditor, exec: slowExec } = openEditor("bbb", slow);

        const pending = slowExec(commentLineAction);
        slowEditor.viewState.type("x");
        release(TS_CONFIGURATION);
        await pending;
        // No edit: the document version moved ahead while the configuration was in flight.
        expect(slowEditor.getText()).toBe("xbbb");

        // The regular (fast) path still works — a control check.
        await exec(commentLineAction);
        expect(editor.getText()).toBe("// aaa");
    });
});
