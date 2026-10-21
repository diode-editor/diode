import { describe, expect, it } from "vitest";

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

const OUTPUT_URI = Uri.from({ scheme: "output", path: "extensions" });

describe("EditorService.openDetached", () => {
    it("creates an editor with a synthetic resource and an empty document", () => {
        const service = createEditorService();

        const pane = service.openDetached(OUTPUT_URI, "log");

        expect(pane.uri.toString()).toBe(OUTPUT_URI.toString());
        expect(pane.getText()).toBe("");
        expect(pane.viewState.document.languageId).toBe("log");
        service.dispose();
    });

    it("does not appear on any surface that lists tabs", () => {
        const service = createEditorService();

        service.openDetached(OUTPUT_URI, "log");

        expect(service.editorGroups.activeGroup.editorCount).toBe(0);
        expect(service.getEditors()).toHaveLength(0);
        expect(service.getOpenFilePaths()).toHaveLength(0);
        service.dispose();
    });

    it("does not take part in the shutdown protocol even with non-empty content", () => {
        const service = createEditorService();
        const pane = service.openDetached(OUTPUT_URI, "log");

        pane.model.appendContent("12:00:00.000 [info] hello\n");

        expect(pane.isModified).toBe(false);
        expect(service.collectDirty()).toHaveLength(0);
        service.dispose();
    });

    it("getActiveEditor does not return the detached editor until focus is inside it", () => {
        const service = createEditorService();
        service.newUntitled({ focus: false });
        const tab = service.getEditors()[0];

        service.openDetached(OUTPUT_URI, "log");

        expect(service.getActiveEditor()).toBe(tab);
        service.dispose();
    });

    it("without tabs and focus there is no active editor", () => {
        const service = createEditorService();

        service.openDetached(OUTPUT_URI, "log");

        expect(service.getActiveEditor()).toBeNull();
        service.dispose();
    });
});

describe("TextFileModel: owner-write for detached", () => {
    it("appendOwnedContent appends to the end without dirtying the buffer", () => {
        const service = createEditorService();
        const pane = service.openDetached(OUTPUT_URI, "log");

        pane.model.appendContent("first\n");
        pane.model.appendContent("second\n");

        expect(pane.getText()).toBe("first\nsecond\n");
        expect(pane.isModified).toBe(false);
        service.dispose();
    });

    it("appendOwnedContent works in a read-only editor", () => {
        // Read-only forbids user edits, but the document owner must be able to write, otherwise the log tail would stall.
        const service = createEditorService();
        const pane = service.openDetached(OUTPUT_URI, "log");
        pane.readOnly = true;

        pane.model.appendContent("line\n");

        expect(pane.getText()).toBe("line\n");
        expect(pane.viewState.type("X")).toBeUndefined();
        expect(pane.getText()).toBe("line\n");
        service.dispose();
    });

    it("an empty append is a no-op", () => {
        const service = createEditorService();
        const pane = service.openDetached(OUTPUT_URI, "log");
        pane.model.appendContent("a\n");
        const versionBefore = pane.viewState.document.versionId;

        pane.model.appendContent("");

        expect(pane.viewState.document.versionId).toBe(versionBefore);
        service.dispose();
    });

    it("replaceOwnedContent replaces the whole content and keeps the language", () => {
        const service = createEditorService();
        const pane = service.openDetached(OUTPUT_URI, "log");
        pane.model.appendContent("old\n");

        pane.model.replaceContent("new\n");

        expect(pane.getText()).toBe("new\n");
        expect(pane.viewState.document.languageId).toBe("log");
        expect(pane.isModified).toBe(false);
        service.dispose();
    });

    it("saving a synthetic buffer does not write to disk", () => {
        const service = createEditorService();
        const pane = service.openDetached(OUTPUT_URI, "log");

        return expect(pane.save()).resolves.toBe("no-file");
    });
});
