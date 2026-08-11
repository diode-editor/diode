import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { describe, expect, it } from "vitest";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";

import { Uri } from "../../../../base/common/uri.ts";
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

/**
 * Вкладка-снимок ({@link EditorService.openTextSnapshot}): текстовая read-only
 * вкладка с контентом от вызывающего (файл на ревизии из `git:`) — модель
 * синтетическая, мимо диска, реестра и персиста.
 */

function createEditorService(): EditorService {
    return new EditorService(
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
}

const REVISION_URI = Uri.from({ scheme: "git", path: "/repo/a.ts", query: '{"path":"/repo/a.ts","ref":"dev"}' });

describe("EditorService.openTextSnapshot", () => {
    it("открывает read-only вкладку с контентом, меткой и языком вызывающего", () => {
        const service = createEditorService();

        const pane = service.openTextSnapshot(REVISION_URI, {
            text: "const x = 1;\n",
            languageId: "typescript",
            label: "a.ts (dev)",
        });

        expect(pane.uri.toString()).toBe(REVISION_URI.toString());
        expect(pane.getText()).toBe("const x = 1;\n");
        expect(pane.label).toBe("a.ts (dev)");
        expect(pane.readOnly).toBe(true);
        expect(pane.viewState.document.languageId).toBe("typescript");
        // Обычная вкладка: в группе, активна. Сравнение ссылок — `===`, не
        // `toBe` (диф-принтер vitest на TUI-объектах валит воркер по памяти).
        expect(service.editorCount).toBe(1);
        expect(service.getActiveTabPane() === pane).toBe(true);
        service.dispose();
    });

    it("буфер не считается изменённым и не просит сохранения", () => {
        const service = createEditorService();

        const pane = service.openTextSnapshot(REVISION_URI, {
            text: "alpha\n",
            languageId: "plaintext",
            label: "a.txt (dev)",
        });

        expect(pane.isModified).toBe(false);
        // Снимок живёт мимо диска: сохранять нечего и незачем.
        expect(pane.absoluteFilePath).toBeNull();
        expect(service.getOpenFilePaths()).toHaveLength(0);
        service.dispose();
    });

    it("повторный вызов с тем же uri обновляет контент существующей вкладки", () => {
        const service = createEditorService();
        service.openTextSnapshot(REVISION_URI, { text: "old\n", languageId: "plaintext", label: "a.ts (dev)" });

        const second = service.openTextSnapshot(REVISION_URI, {
            text: "new\n",
            languageId: "plaintext",
            label: "a.ts (dev)",
        });

        expect(service.editorCount).toBe(1);
        expect(second.getText()).toBe("new\n");
        expect(second.readOnly).toBe(true);
        service.dispose();
    });

    it("другая ревизия того же файла — отдельная вкладка", () => {
        const service = createEditorService();
        service.openTextSnapshot(REVISION_URI, { text: "dev\n", languageId: "plaintext", label: "a.ts (dev)" });

        const mainUri = Uri.from({ scheme: "git", path: "/repo/a.ts", query: '{"path":"/repo/a.ts","ref":"main"}' });
        service.openTextSnapshot(mainUri, { text: "main\n", languageId: "plaintext", label: "a.ts (main)" });

        expect(service.editorCount).toBe(2);
        service.dispose();
    });
});

describe("TextFileModel.openFile — гейт схемы", () => {
    it("не-file uri отвергается, а не читается с диска по fsPath", () => {
        const service = createEditorService();

        expect(() => {
            service.openUri(REVISION_URI);
        }).toThrow(/file:-uri/u);
        service.dispose();
    });
});
