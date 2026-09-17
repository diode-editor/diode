import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { createTestEditorContextMenuController } from "../../../../TestUtils/testEditorContextMenu.ts";
import { createCursorSelection, createSelection } from "../../../editor/common/core/iSelection.ts";
import type { ILanguageConfigurationService } from "../../../editor/common/languages/iLanguageConfigurationService.ts";
import { LanguageConfigurationServiceDIToken } from "../../../editor/common/languages/iLanguageConfigurationService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../editor/common/languages/iTokenStyleResolver.ts";
import {
    EMPTY_LANGUAGE_CONFIGURATION,
    type IResolvedLanguageConfiguration,
} from "../../../editor/common/languages/languageConfiguration.ts";
import { TokenizationRegistry } from "../../../editor/common/languages/tokenizationRegistry.ts";
import { TextDocument } from "../../../editor/common/model/textDocument.ts";
import { EditorViewState } from "../../../editor/common/viewModel/editorViewState.ts";
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
        get: () => configuration,
        ensureLoaded: () => Promise.resolve(configuration),
    };
}

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

function openEditor(content: string, languages: ILanguageConfigurationService = fixedConfiguration(TS_CONFIGURATION)) {
    const ctrl = createGroup();
    const filePath = ws.writeFile("doc.txt", content);
    ctrl.openFile(filePath);
    const editor = ctrl.getActiveEditor();
    if (editor === null) throw new Error("no active editor");

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

describe("commentActions — id и бинды, как в VS Code", () => {
    it("ID команд и клавиши совпадают со стоковыми", () => {
        expect(commentLineAction.id).toBe("editor.action.commentLine");
        expect(commentLineAction.keybinding).toEqual(parseKeybinding("ctrl+/"));
        expect(addCommentLineAction.id).toBe("editor.action.addCommentLine");
        expect(addCommentLineAction.keybinding).toEqual(parseChord("ctrl+k ctrl+c"));
        expect(removeCommentLineAction.id).toBe("editor.action.removeCommentLine");
        expect(removeCommentLineAction.keybinding).toEqual(parseChord("ctrl+k ctrl+u"));
        expect(blockCommentAction.id).toBe("editor.action.blockComment");
        expect(blockCommentAction.keybinding).toEqual(parseKeybinding("shift+alt+a"));
        for (const action of [commentLineAction, addCommentLineAction, removeCommentLineAction, blockCommentAction]) {
            expect(action.when).toBe("textInputFocus && !editorReadonly");
        }
    });
});

describe("commentActions — исполнение над активным редактором", () => {
    it("commentLine тогглит строку каретки токеном языка", async () => {
        const { editor, exec } = openEditor("const a = 1;");
        editor.viewState.selections = [createCursorSelection(0, 0)];
        await exec(commentLineAction);
        expect(editor.getText()).toBe("// const a = 1;");
        await exec(commentLineAction);
        expect(editor.getText()).toBe("const a = 1;");
    });

    it("commentLine кладёт шаг в undo редактора", async () => {
        const { editor, exec } = openEditor("aaa");
        await exec(commentLineAction);
        expect(editor.getText()).toBe("// aaa");
        editor.undo();
        expect(editor.getText()).toBe("aaa");
    });

    it("add/remove работают принудительно, не глядя на состояние строки", async () => {
        const { editor, exec } = openEditor("// aaa");
        await exec(addCommentLineAction);
        expect(editor.getText()).toBe("// // aaa");
        await exec(removeCommentLineAction);
        expect(editor.getText()).toBe("// aaa");
    });

    it("blockComment оборачивает выделение", async () => {
        const { editor, exec } = openEditor("const a = 1;");
        editor.viewState.selections = [createSelection(0, 6, 0, 7)];
        await exec(blockCommentAction);
        expect(editor.getText()).toBe("const /* a */ = 1;");
    });

    it("язык без секции comments — no-op", async () => {
        const { editor, exec } = openEditor("aaa", fixedConfiguration(EMPTY_LANGUAGE_CONFIGURATION));
        await exec(commentLineAction);
        expect(editor.getText()).toBe("aaa");
    });

    it("без активного редактора — безопасный no-op", async () => {
        const ctrl = createGroup();
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

    it("документ, ПОДМЕНЁННЫЙ пока конфигурация грузилась, не правится задним числом", async () => {
        // Перечитка файла с диска пересоздаёт документ и view-state редактора.
        // Версия у свежего документа своя и может совпасть с захваченной, поэтому
        // команда сверяет не только её, но и сам документ.
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

    it("документ, изменившийся ПОКА конфигурация грузилась, не правится задним числом", async () => {
        const { editor, exec } = openEditor("aaa");
        let release: (value: IResolvedLanguageConfiguration) => void = () => undefined;
        const gate = new Promise<IResolvedLanguageConfiguration>((resolve) => {
            release = resolve;
        });
        const slow: ILanguageConfigurationService = {
            get: () => undefined,
            ensureLoaded: () => gate,
        };
        const { editor: slowEditor, exec: slowExec } = openEditor("bbb", slow);

        const pending = slowExec(commentLineAction);
        slowEditor.viewState.type("x");
        release(TS_CONFIGURATION);
        await pending;
        // Правки нет: версия документа ушла вперёд, пока конфигурация была в полёте.
        expect(slowEditor.getText()).toBe("xbbb");

        // Обычный (быстрый) путь при этом работает — контрольная проверка.
        await exec(commentLineAction);
        expect(editor.getText()).toBe("// aaa");
    });
});
