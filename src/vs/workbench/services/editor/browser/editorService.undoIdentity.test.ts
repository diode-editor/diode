import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import * as fs from "node:fs";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";

import { EditorService } from "./editorService.ts";

let ws: ITempWorkspace;
let tmpDir: string;

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "vexx-undoid-" });
    tmpDir = ws.dir;
});

afterEach(() => {
    ws.dispose();
});

function createGroup(): EditorService {
    const group = new EditorService(
        new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
        new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        NULL_LANGUAGE_SERVICE,
        NULL_CONFIGURATION_SERVICE,
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
        NULL_LOG_SERVICE,
    );
    return group;
}

/**
 * Идентичность истории отмены: у каждого редактора свой бакет, и он переживает
 * смену пути. Проверяем через публичный контракт (текст буферов), а не через
 * ключ бакета — ключ намеренно непрозрачен.
 */
describe("EditorService — идентичность истории отмены", () => {
    it("два untitled-буфера не делят историю: undo в одном не трогает другой", () => {
        const group = createGroup();
        group.newUntitled();
        const first = group.getActiveEditor()!;
        group.newUntitled();
        const second = group.getActiveEditor()!;

        first.pushUndo(first.viewState.type("first"));
        second.pushUndo(second.viewState.type("second"));

        first.undo();

        expect(first.getText()).toBe("");
        expect(second.getText()).toBe("second");
    });

    it("закрытие одного untitled-буфера не чистит историю другого", () => {
        const group = createGroup();
        group.newUntitled();
        const first = group.getActiveEditor()!;
        group.newUntitled();
        const second = group.getActiveEditor()!;

        first.pushUndo(first.viewState.type("first"));
        second.pushUndo(second.viewState.type("second"));

        group.closeTab(0);

        second.undo();
        expect(second.getText()).toBe("");
    });

    it("saveAs сохраняет историю: undo откатывает правку, сделанную до сохранения", async () => {
        const group = createGroup();
        group.newUntitled();
        const editor = group.getActiveEditor()!;

        editor.pushUndo(editor.viewState.type("before save"));
        await editor.saveAs(path.join(tmpDir, "note.txt"));

        editor.undo();

        expect(editor.getText()).toBe("");
    });

    it("saveAs сохраняет историю: redo после undo возвращает правку", async () => {
        const group = createGroup();
        group.newUntitled();
        const editor = group.getActiveEditor()!;

        editor.pushUndo(editor.viewState.type("before save"));
        await editor.saveAs(path.join(tmpDir, "note.txt"));

        editor.undo();
        // Промежуточный ассерт обязателен: без него тест проходит вакуумно —
        // сломанный undo просто ничего не делает, и текст остаётся исходным.
        expect(editor.getText()).toBe("");

        editor.redo();
        expect(editor.getText()).toBe("before save");
    });

    it("undo не смешивает истории двух открытых файлов", () => {
        const group = createGroup();
        const alpha = path.join(tmpDir, "alpha.txt");
        const beta = path.join(tmpDir, "beta.txt");
        fs.writeFileSync(alpha, "");
        fs.writeFileSync(beta, "");

        group.openFile(alpha);
        const first = group.getActiveEditor()!;
        group.openFile(beta);
        const second = group.getActiveEditor()!;

        first.pushUndo(first.viewState.type("alpha edit"));
        second.pushUndo(second.viewState.type("beta edit"));

        first.undo();

        expect(first.getText()).toBe("");
        expect(second.getText()).toBe("beta edit");
    });
});
