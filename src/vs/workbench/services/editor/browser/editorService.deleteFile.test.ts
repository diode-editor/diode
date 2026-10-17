import * as fs from "node:fs";

import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import type { FileService } from "../../../../platform/files/common/fileService.ts";
import type { IFileWatcher } from "../../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { ORPHAN_CHECK_DELAY_MS } from "../../textfile/common/textFileModel.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";

import { EditorService } from "./editorService.ts";

/** Ручной watcher: «внешнее удаление» тест объявляет сам. */
class FakeFileWatcher implements IFileWatcher {
    private readonly handlers = new Map<string, (() => void)[]>();

    public watchFile(filePath: string, onChange: () => void): IDisposable {
        const list = this.handlers.get(filePath) ?? [];
        list.push(onChange);
        this.handlers.set(filePath, list);
        return {
            dispose: () => {
                list.splice(list.indexOf(onChange), 1);
            },
        };
    }

    public fire(filePath: string): void {
        for (const handler of [...(this.handlers.get(filePath) ?? [])]) handler();
    }
}

/**
 * Удалённый файл и открытые вкладки (эталон `EditorService.handleDeletedFile`):
 * удаление изнутри редактора закрывает чистые вкладки всегда, внешнее — только
 * при `workbench.editor.closeOnFileDelete`; вкладка с несохранёнными правками
 * не закрывается никогда.
 */
describe("EditorService — вкладки удалённого файла", () => {
    let ws: ITempWorkspace;
    let files: FileService;
    let watcher: FakeFileWatcher;
    let service: EditorService;
    let config: InMemoryConfigurationService;

    function createService(closeOnFileDelete: boolean): EditorService {
        config = createTestConfigurationService({ "workbench.editor.closeOnFileDelete": closeOnFileDelete });
        return new EditorService(
            new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
            new TokenizationRegistry(),
            NULL_TOKEN_STYLE_RESOLVER,
            NULL_LANGUAGE_SERVICE,
            config,
            new UndoRedoService(),
            watcher,
            createTestEditorContextMenuController(),
            NULL_LOG_SERVICE,
            undefined,
            undefined,
            [],
            undefined,
            files,
        );
    }

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-delete-",
            files: { "a.txt": "alpha\n", "b.txt": "beta\n", "src/c.txt": "gamma\n", "src2/d.txt": "delta\n" },
        });
        files = diskFileService();
        watcher = new FakeFileWatcher();
        service = createService(false);
    });

    afterEach(() => {
        service.dispose();
        files.dispose();
        ws.dispose();
        vi.useRealTimers();
    });

    const tabs = (group = 0): string[] => service.editorGroups.groups[group].getPanes().map((pane) => pane.uri.fsPath);

    const textPane = (group: number, index: number): TextEditorPane => {
        const pane = service.editorGroups.groups[group].getPane(index);
        expect(pane).toBeInstanceOf(TextEditorPane);
        return pane as TextEditorPane;
    };

    const type = (pane: TextEditorPane): void => {
        pane.applyExternalEdits([createTextEdit(createRange(0, 0, 0, 0), "!")], "type");
    };

    describe("удаление изнутри редактора", () => {
        it("через файловый сервис: чистая вкладка закрывается, грязная и чужая остаются", async () => {
            service.openFile(ws.path("a.txt"));
            service.openFile(ws.path("b.txt"));
            type(textPane(0, 1));

            await files.del(Uri.file(ws.path("a.txt")));
            await files.del(Uri.file(ws.path("b.txt")));

            expect(tabs()).toEqual([ws.path("b.txt")]);
            expect(textPane(0, 0).isModified).toBe(true);
        });

        it("каталог: закрываются вложенные вкладки, соседний каталог с общим префиксом — нет", async () => {
            service.openFile(ws.path("src/c.txt"));
            service.openFile(ws.path("src2/d.txt"));
            service.openFile(ws.path("a.txt"));

            await files.del(Uri.file(ws.path("src")), { recursive: true });

            expect(tabs()).toEqual([ws.path("src2/d.txt"), ws.path("a.txt")]);
        });

        it("мимо сервиса (корзина) — handleDeletedFile закрывает так же", () => {
            service.openFile(ws.path("src/c.txt"));
            service.openFile(ws.path("a.txt"));

            service.handleDeletedFile(Uri.file(ws.path("src")));

            expect(tabs()).toEqual([ws.path("a.txt")]);
        });

        it("файл в двух группах — чистые вкладки закрываются в обеих", async () => {
            service.openFile(ws.path("a.txt"));
            service.splitActiveGroup();
            await Promise.resolve();
            expect(service.editorGroups.groups).toHaveLength(2);

            service.handleDeletedFile(Uri.file(ws.path("a.txt")));

            expect(service.editorGroups.groups.flatMap((group) => group.getPanes())).toEqual([]);
        });

        it("панель другого вида под удалённым каталогом остаётся", () => {
            const other: IEditorPane = {
                uri: Uri.file(ws.path("src/c.txt")),
                label: "c.txt (preview)",
                view: new TUIElement(),
                isModified: false,
                readOnly: true,
                getSelectedTexts: () => [],
                onDidChangeState: () => ({ dispose: () => undefined }),
                focusEditor: () => undefined,
                dispose: () => undefined,
            };
            service.openPane(other);

            service.handleDeletedFile(Uri.file(ws.path("src")));

            expect(service.editorGroups.groups[0].getPanes()).toEqual([other]);
        });

        it("вкладки без файловой модели по тому же пути (снимок) остаются", () => {
            const snapshot = service.openTextSnapshot(Uri.file(ws.path("a.txt")), {
                text: "snapshot\n",
                languageId: "plaintext",
                label: "a.txt (HEAD)",
            });

            service.handleDeletedFile(Uri.file(ws.path("a.txt")));

            expect(service.editorGroups.groups[0].getPanes()).toEqual([snapshot]);
        });

        it("другие операции сервиса (создание, запись) вкладок не закрывают", async () => {
            service.openFile(ws.path("a.txt"));

            await files.writeFile(Uri.file(ws.path("a.txt")), new TextEncoder().encode("alpha\n"));
            await files.createFolder(Uri.file(ws.path("src/new")));

            expect(tabs()).toEqual([ws.path("a.txt")]);
        });
    });

    describe("внешнее удаление", () => {
        function deleteExternally(rel: string): void {
            fs.rmSync(ws.path(rel));
            watcher.fire(ws.path(rel));
            vi.advanceTimersByTime(ORPHAN_CHECK_DELAY_MS);
        }

        it("по умолчанию вкладка остаётся и зачёркивается (orphaned)", () => {
            vi.useFakeTimers();
            service.openFile(ws.path("a.txt"));

            deleteExternally("a.txt");

            expect(tabs()).toEqual([ws.path("a.txt")]);
            expect(textPane(0, 0).isOrphaned).toBe(true);
        });

        it("closeOnFileDelete: чистая вкладка закрывается, грязная остаётся зачёркнутой", () => {
            vi.useFakeTimers();
            service.dispose();
            service = createService(true);
            service.openFile(ws.path("a.txt"));
            service.openFile(ws.path("b.txt"));
            type(textPane(0, 1));

            service.openFile(ws.path("src/c.txt"));

            deleteExternally("a.txt");
            deleteExternally("b.txt");

            // Чистая c.txt жива: закрываются только вкладки удалённого файла.
            expect(tabs()).toEqual([ws.path("b.txt"), ws.path("src/c.txt")]);
            expect(textPane(0, 0).isOrphaned).toBe(true);
        });

        it("closeOnFileDelete включили, пока вкладка была зачёркнута: вернувшийся файл её не закрывает", async () => {
            vi.useFakeTimers();
            service.openFile(ws.path("a.txt"));
            deleteExternally("a.txt");
            await config.updateValue("workbench.editor.closeOnFileDelete", true);

            fs.writeFileSync(ws.path("a.txt"), "back\n");
            watcher.fire(ws.path("a.txt"));

            expect(tabs()).toEqual([ws.path("a.txt")]);
            expect(textPane(0, 0).isOrphaned).toBe(false);
        });

        it("closeOnFileDelete: вернувшийся файл вкладку не закрывает", () => {
            vi.useFakeTimers();
            service.dispose();
            service = createService(true);
            service.openFile(ws.path("a.txt"));
            deleteExternally("a.txt");
            service.openFile(ws.path("b.txt"));
            type(textPane(0, 0));
            deleteExternally("b.txt");

            fs.writeFileSync(ws.path("b.txt"), "back\n");
            watcher.fire(ws.path("b.txt"));

            expect(tabs()).toEqual([ws.path("b.txt")]);
            expect(textPane(0, 0).isOrphaned).toBe(false);
        });
    });
});
