import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { FileService } from "../../../../platform/files/common/fileService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";

import { EditorService, movedResource } from "./editorService.ts";

/**
 * Перенос файла через файловый сервис (rename/move проводника и их отмена) —
 * вкладки едут за файлом, как `EditorService.handleMovedFile` эталона. Баг из
 * догфудинга: вкладка оставалась на старом пути, сохранение воскрешало
 * переименованный файл, и git показывал «новый + изменённый старый».
 */
describe("EditorService — вкладки едут за перенесённым файлом", () => {
    let ws: ITempWorkspace;
    let files: FileService;
    let service: EditorService;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-move-",
            files: { "old.txt": "one\ntwo\n", "other.txt": "keep\n", "src/a.txt": "alpha\n", "src2/b.txt": "beta\n" },
        });
        files = diskFileService();
        service = new EditorService(
            new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
            new TokenizationRegistry(),
            NULL_TOKEN_STYLE_RESOLVER,
            NULL_LANGUAGE_SERVICE,
            createTestConfigurationService({ "workbench.editor.enablePreview": true }),
            new UndoRedoService(),
            NULL_FILE_WATCHER,
            createTestEditorContextMenuController(),
            NULL_LOG_SERVICE,
            undefined,
            undefined,
            [],
            undefined,
            files,
        );
    });

    afterEach(() => {
        service.dispose();
        files.dispose();
        ws.dispose();
    });

    const tabs = (group = 0): { path: string; label: string }[] =>
        service.editorGroups.groups[group].getPanes().map((pane) => ({ path: pane.uri.fsPath, label: pane.label }));

    const textPane = (group: number, index: number): TextEditorPane => {
        const pane = service.editorGroups.groups[group].getPane(index);
        expect(pane).toBeInstanceOf(TextEditorPane);
        return pane as TextEditorPane;
    };

    const move = (from: string, to: string): Promise<void> =>
        files.move(Uri.file(ws.path(from)), Uri.file(ws.path(to)));

    it("переименованный файл: вкладка на том же месте с новым путём, сохранение пишет туда, старый не воскресает", async () => {
        service.openFile(ws.path("old.txt"));
        service.openFile(ws.path("other.txt"));
        service.editorGroups.groups[0].activateTab(0);
        textPane(0, 0).viewState.selections = [createCursorSelection(1, 2)];

        await move("old.txt", "new.txt");

        expect(tabs()).toEqual([
            { path: ws.path("new.txt"), label: "new.txt" },
            { path: ws.path("other.txt"), label: "other.txt" },
        ]);
        expect(service.editorGroups.groups[0].activeIndex).toBe(0);
        expect(service.getActiveEditor()?.uri.fsPath).toBe(ws.path("new.txt"));
        const moved = textPane(0, 0);
        expect(moved.model.getText()).toBe("one\ntwo\n");
        expect(moved.isModified).toBe(false);
        expect(moved.viewState.selections).toEqual([createCursorSelection(1, 2)]);

        moved.applyExternalEdits([createTextEdit(createRange(0, 0, 0, 0), "X")], "type");
        expect(await moved.save()).toBe("saved");
        expect(fs.readFileSync(ws.path("new.txt"), "utf8")).toBe("Xone\ntwo\n");
        expect(fs.existsSync(ws.path("old.txt"))).toBe(false);
    });

    it("несохранённые правки переезжают: буфер по новому пути изменён, на диске — прежний текст", async () => {
        service.openFile(ws.path("old.txt"));
        textPane(0, 0).applyExternalEdits([createTextEdit(createRange(1, 0, 1, 3), "TWO")], "type");

        await move("old.txt", "new.txt");

        const moved = textPane(0, 0);
        expect(moved.uri.fsPath).toBe(ws.path("new.txt"));
        expect(moved.model.getText()).toBe("one\nTWO\n");
        expect(moved.isModified).toBe(true);
        expect(fs.readFileSync(ws.path("new.txt"), "utf8")).toBe("one\ntwo\n");

        expect(await moved.save()).toBe("saved");
        expect(moved.isModified).toBe(false);
        expect(fs.readFileSync(ws.path("new.txt"), "utf8")).toBe("one\nTWO\n");
        expect(fs.existsSync(ws.path("old.txt"))).toBe(false);
    });

    it("файл в двух группах: обе вкладки на новом пути, общая модель, правки перелиты один раз", async () => {
        service.openFile(ws.path("old.txt"));
        textPane(0, 0).applyExternalEdits([createTextEdit(createRange(0, 0, 0, 0), "!")], "type");
        service.splitActiveGroup();
        await Promise.resolve();
        expect(service.editorGroups.groups).toHaveLength(2);

        await move("old.txt", "new.txt");

        expect(tabs(0)).toEqual([{ path: ws.path("new.txt"), label: "new.txt" }]);
        expect(tabs(1)).toEqual([{ path: ws.path("new.txt"), label: "new.txt" }]);
        expect(textPane(0, 0).model).toBe(textPane(1, 0).model);
        expect(textPane(1, 0).model.getText()).toBe("!one\ntwo\n");
        expect(textPane(1, 0).isModified).toBe(true);
    });

    it("перенос каталога уводит вложенные вкладки, соседний каталог с общим префиксом не трогает", async () => {
        service.openFile(ws.path("src/a.txt"));
        service.openFile(ws.path("src2/b.txt"));

        await move("src", "lib");

        expect(tabs()).toEqual([
            { path: ws.path("lib/a.txt"), label: "a.txt" },
            { path: ws.path("src2/b.txt"), label: "b.txt" },
        ]);
        expect(textPane(0, 0).model.getText()).toBe("alpha\n");
        // Активной была вторая вкладка — она активной и осталась.
        expect(service.editorGroups.groups[0].activeIndex).toBe(1);
    });

    it("предпросмотр остаётся предпросмотром, приколотая — приколотой", async () => {
        service.openFile(ws.path("other.txt"));
        await service.openUri(Uri.file(ws.path("old.txt")), { preview: true });
        const group = service.editorGroups.groups[0];
        expect(group.previewPane?.uri.fsPath).toBe(ws.path("old.txt"));

        await move("old.txt", "new.txt");
        expect(group.previewPane?.uri.fsPath).toBe(ws.path("new.txt"));

        await move("other.txt", "renamed.txt");
        expect(group.isPinned(textPane(0, 0))).toBe(true);
        expect(textPane(0, 0).uri.fsPath).toBe(ws.path("renamed.txt"));
    });

    it("перенос чужого файла и копирование вкладок не трогают", async () => {
        service.openFile(ws.path("old.txt"));
        const before = textPane(0, 0);

        await move("other.txt", "moved.txt");
        await files.copy(Uri.file(ws.path("old.txt")), Uri.file(ws.path("copy.txt")));

        expect(textPane(0, 0)).toBe(before);
        expect(tabs()).toEqual([{ path: ws.path("old.txt"), label: "old.txt" }]);
    });
});

describe("movedResource", () => {
    const source = Uri.file("/repo/src");
    const target = Uri.file("/repo/lib");

    it("сам перенесённый ресурс — на цель", () => {
        expect(movedResource(Uri.file("/repo/src"), source, target)?.fsPath).toBe("/repo/lib");
    });

    it("вложенный — на тот же относительный путь под целью", () => {
        expect(movedResource(Uri.file("/repo/src/deep/a.ts"), source, target)?.fsPath).toBe("/repo/lib/deep/a.ts");
    });

    it("сосед с общим префиксом, родитель и файл с именем на `..` — мимо", () => {
        expect(movedResource(Uri.file("/repo/src2/a.ts"), source, target)).toBeNull();
        expect(movedResource(Uri.file("/repo"), source, target)).toBeNull();
        expect(movedResource(Uri.file("/repo/src/..x"), Uri.file("/repo/src/..x"), target)?.fsPath).toBe("/repo/lib");
        expect(movedResource(Uri.file("/repo/..hidden"), Uri.file("/repo/src"), target)).toBeNull();
    });

    it("недисковый ресурс — мимо", () => {
        expect(movedResource(Uri.parse("untitled:Untitled-1"), source, target)).toBeNull();
    });
});
