import { describe, expect, it, vi } from "vitest";

import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../../../base/common/uri.ts";
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
    it("opens a read-only tab with the caller's content, label and language", () => {
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
        // `===`, not `toBe`: vitest's diff printer on TUI objects crashes the worker out of memory.
        expect(service.editorGroups.activeGroup.editorCount).toBe(1);
        expect(service.getActiveTabPane() === pane).toBe(true);
        service.dispose();
    });

    it("the buffer is not considered modified and does not ask to be saved", () => {
        const service = createEditorService();

        const pane = service.openTextSnapshot(REVISION_URI, {
            text: "alpha\n",
            languageId: "plaintext",
            label: "a.txt (dev)",
        });

        expect(pane.isModified).toBe(false);
        expect(pane.absoluteFilePath).toBeNull();
        expect(service.getOpenFilePaths()).toHaveLength(0);
        service.dispose();
    });

    it("a repeated call with the same uri updates the existing tab's content", () => {
        const service = createEditorService();
        service.openTextSnapshot(REVISION_URI, { text: "old\n", languageId: "plaintext", label: "a.ts (dev)" });

        const second = service.openTextSnapshot(REVISION_URI, {
            text: "new\n",
            languageId: "plaintext",
            label: "a.ts (dev)",
        });

        expect(service.editorGroups.activeGroup.editorCount).toBe(1);
        expect(second.getText()).toBe("new\n");
        expect(second.readOnly).toBe(true);
        service.dispose();
    });

    it("a repeated call with focus: false activates the tab without taking focus", () => {
        const service = createEditorService();
        const first = service.openTextSnapshot(REVISION_URI, { text: "a\n", languageId: "plaintext", label: "a" });
        const otherUri = Uri.from({ scheme: "git", path: "/repo/b.ts", query: '{"path":"/repo/b.ts","ref":"dev"}' });
        service.openTextSnapshot(otherUri, { text: "b\n", languageId: "plaintext", label: "b" });
        const focused = vi.spyOn(first, "focusEditor");

        service.openTextSnapshot(REVISION_URI, { text: "a\n", languageId: "plaintext", label: "a", focus: false });

        expect(service.getActiveTabPane() === first).toBe(true);
        expect(focused).not.toHaveBeenCalled();

        service.openTextSnapshot(REVISION_URI, { text: "a\n", languageId: "plaintext", label: "a" });
        expect(focused).toHaveBeenCalled();
        service.dispose();
    });

    it("another revision of the same file is a separate tab", () => {
        const service = createEditorService();
        service.openTextSnapshot(REVISION_URI, { text: "dev\n", languageId: "plaintext", label: "a.ts (dev)" });

        const mainUri = Uri.from({ scheme: "git", path: "/repo/a.ts", query: '{"path":"/repo/a.ts","ref":"main"}' });
        service.openTextSnapshot(mainUri, { text: "main\n", languageId: "plaintext", label: "a.ts (main)" });

        expect(service.editorGroups.activeGroup.editorCount).toBe(2);
        service.dispose();
    });
});

describe("TextFileModel.openFile — scheme gate", () => {
    it("a non-file uri is not read from disk by fsPath and does not throw", async () => {
        const service = createEditorService();
        const failures: string[] = [];
        service.onDidFailOpen(({ uri, reason }) => failures.push(`${uri.scheme}: ${reason}`));

        // Must not throw: a rejection from any open would take down the whole editor via unhandled rejection.
        await expect(service.openUri(REVISION_URI)).resolves.toBeUndefined();

        expect(service.editorGroups.activeGroup.editorCount).toBe(0);
        expect(failures).toEqual(['git: no content provider is registered for the "git:" scheme']);
        service.dispose();
    });
});
