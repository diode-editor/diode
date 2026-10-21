import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";

import { EditorService } from "./editorService.ts";

let ws: ITempWorkspace;
let tmpDir: string;

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-undoid-" });
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
        undefined,
        undefined,
        undefined,
        undefined,
        diskFileService(),
    );
    return group;
}

/** Via buffer text, not the bucket key: the key is opaque on purpose. */
describe("EditorService — undo history identity", () => {
    it("two untitled buffers do not share history: undo in one does not affect the other", () => {
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

    it("closing one untitled buffer does not clear the other's history", () => {
        const group = createGroup();
        group.newUntitled();
        const first = group.getActiveEditor()!;
        group.newUntitled();
        const second = group.getActiveEditor()!;

        first.pushUndo(first.viewState.type("first"));
        second.pushUndo(second.viewState.type("second"));

        group.editorGroups.activeGroup.closeTab(0);

        second.undo();
        expect(second.getText()).toBe("");
    });

    it("saveAs keeps history: undo reverts an edit made before saving", async () => {
        const group = createGroup();
        group.newUntitled();
        const editor = group.getActiveEditor()!;

        editor.pushUndo(editor.viewState.type("before save"));
        await editor.saveAs(path.join(tmpDir, "note.txt"));

        editor.undo();

        expect(editor.getText()).toBe("");
    });

    it("saveAs keeps history: redo after undo restores the edit", async () => {
        const group = createGroup();
        group.newUntitled();
        const editor = group.getActiveEditor()!;

        editor.pushUndo(editor.viewState.type("before save"));
        await editor.saveAs(path.join(tmpDir, "note.txt"));

        editor.undo();
        // The intermediate assert is required: without it the test passes vacuously,
        // since a broken undo does nothing and the text stays the original.
        expect(editor.getText()).toBe("");

        editor.redo();
        expect(editor.getText()).toBe("before save");
    });

    it("undo does not mix the histories of two open files", () => {
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
