import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { createTestEditorContextMenuController } from "../../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";
import { DialogService } from "../../services/dialogs/browser/dialogService.ts";
import { EditorService } from "../../services/editor/browser/editorService.ts";
import { darkPlusTheme } from "../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../services/themes/common/themeService.ts";

import { EditorLayoutServiceAdapter } from "./editorLayoutServiceAdapter.ts";

const LANGUAGES = {
    getRegisteredLanguageIds: () => ["plaintext", "json", "python"],
    getLanguageIdForResource: (path: string) => (path.endsWith(".py") ? "python" : undefined),
};

describe("EditorLayoutServiceAdapter — language of a document", () => {
    let ws: ITempWorkspace;
    let service: EditorService;
    let adapter: EditorLayoutServiceAdapter;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-layout-language-", files: { "a.txt": "alpha", "b.txt": "beta" } });
        const dialogs = new DialogService();
        dialogs.attachHost(new BodyElement());
        service = new EditorService(
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
            dialogs,
        );
        adapter = new EditorLayoutServiceAdapter(service, service.editorGroups, LANGUAGES);
    });

    afterEach(() => {
        adapter.dispose();
        service.dispose();
        ws.dispose();
    });

    const uriOf = (name: string): string => Uri.file(ws.path(name)).toString();
    const activeLanguage = (): string | undefined => service.getTextSurfaces().at(-1)?.model.languageId;

    it("lists the registered languages", () => {
        expect(adapter.getLanguages()).toEqual(["plaintext", "json", "python"]);
    });

    it("an open document changes language in its model", () => {
        service.openFile(ws.path("a.txt"));
        const onChange = vi.fn();
        service.getTextSurfaces()[0].model.onDidChangeLanguage(onChange);

        expect(adapter.changeDocumentLanguage({ uri: uriOf("a.txt"), languageId: "json" })).toEqual({ applied: true });

        expect(activeLanguage()).toBe("json");
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("an untitled buffer without a tab has a model too", () => {
        const uri = service.createUntitled().toString();

        expect(adapter.changeDocumentLanguage({ uri, languageId: "json" })).toEqual({ applied: true });

        expect(service.getUntitledModelsWithoutEditor()[0].languageId).toBe("json");
    });

    it("an unknown language is refused with upstream's message and nothing changes", () => {
        service.openFile(ws.path("a.txt"));
        const before = activeLanguage();

        expect(() => adapter.changeDocumentLanguage({ uri: uriOf("a.txt"), languageId: "nope" })).toThrow(
            "Unknown language id: nope",
        );
        expect(() => adapter.changeDocumentLanguage({ uri: uriOf("b.txt"), languageId: "nope" })).toThrow(
            "Unknown language id: nope",
        );

        expect(activeLanguage()).toBe(before);
        expect(adapter.getLanguageOfDocument(uriOf("b.txt"))).toBeNull();
    });

    it("a document without a model keeps the language until a tab shows it, once", async () => {
        const uri = uriOf("a.txt");

        expect(adapter.changeDocumentLanguage({ uri, languageId: "json" })).toEqual({ applied: false });
        expect(adapter.getLanguageOfDocument(uri)).toBe("json");

        await adapter.showTextDocument({ uri });
        expect(activeLanguage()).toBe("json");
        expect(adapter.getLanguageOfDocument(uri)).toBeNull();

        // The choice is spent: a language picked later is not overwritten by the next show.
        adapter.changeDocumentLanguage({ uri, languageId: "python" });
        await adapter.showTextDocument({ uri });
        expect(activeLanguage()).toBe("python");
    });

    it("showing another document leaves a waiting language alone", async () => {
        adapter.changeDocumentLanguage({ uri: uriOf("a.txt"), languageId: "json" });

        await adapter.showTextDocument({ uri: uriOf("b.txt") });

        expect(activeLanguage()).not.toBe("json");
        expect(adapter.getLanguageOfDocument(uriOf("a.txt"))).toBe("json");
    });

    it("the language of a document without a model comes from its path", () => {
        expect(adapter.getLanguageOfDocument("foo://auth/dir/x.py")).toBe("python");
        expect(adapter.getLanguageOfDocument("file:///x.unknown")).toBeNull();
    });

    it("the default language service knows plaintext only", () => {
        const plain = new EditorLayoutServiceAdapter(service, service.editorGroups);

        expect(plain.getLanguages()).toEqual(["plaintext"]);
        plain.dispose();
    });
});
