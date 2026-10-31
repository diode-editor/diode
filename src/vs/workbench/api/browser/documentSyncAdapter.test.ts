import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { diskFileService } from "../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../../TestUtils/testConfigurationService.ts";
import { createTestEditorContextMenuController } from "../../../../TestUtils/testEditorContextMenu.ts";
import { createRange } from "../../../editor/common/core/iRange.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";
import { EditorService } from "../../services/editor/browser/editorService.ts";
import { darkPlusTheme } from "../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../services/themes/common/themeService.ts";
import type { IDocumentSyncSource, IDocumentSyncTarget } from "../common/iDocumentSyncTarget.ts";
import type { IWireDocumentChangedEvent } from "../common/wireTypes.ts";

import { bindDocumentSync, documentSyncSourceOfModel, openDocumentSyncSources } from "./documentSyncAdapter.ts";

describe("documentSyncAdapter", () => {
    let ws: ITempWorkspace;
    let service: EditorService;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-docsync-adapter-",
            files: { "a.ts": "alpha", "b.ts": "beta" },
        });
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
            undefined,
            [],
            undefined,
            diskFileService(),
        );
    });

    afterEach(() => {
        service.dispose();
        ws.dispose();
    });

    function recordingHost(): {
        host: IDocumentSyncTarget;
        opened: string[];
        changed: string[];
        deltas: IWireDocumentChangedEvent[];
        flushes: IDocumentSyncSource[];
        closed: string[];
    } {
        const opened: string[] = [];
        const changed: string[] = [];
        const deltas: IWireDocumentChangedEvent[] = [];
        const flushes: IDocumentSyncSource[] = [];
        const closed: string[] = [];
        const host: IDocumentSyncTarget = {
            didOpenTextDocument: (snapshot) => opened.push(snapshot.uri),
            didChangeTextDocument: (snapshot) => {
                changed.push(snapshot.uri);
                flushes.push(snapshot);
            },
            didChangeTextDocumentContent: (event) => {
                changed.push(event.uri);
                deltas.push(event);
            },
            didCloseTextDocument: (uri) => closed.push(uri),
            didChangeTextDocumentState: () => undefined,
        };
        return { host, opened, changed, deltas, flushes, closed };
    }

    it("openDocumentSyncSources: a document in two groups yields one source", () => {
        service.openFile(ws.path("a.ts"));
        service.splitActiveGroup();
        service.openFile(ws.path("b.ts"));

        const sources = openDocumentSyncSources(service);
        expect(sources.map((s) => s.getText())).toEqual(["alpha", "beta"]);
    });

    it("documentSyncSourceOfModel: identity, version, dirty and length come from the model; the text is built only by getText", () => {
        service.openFile(ws.path("a.ts"));
        const editor = service.getActiveEditor()!;
        editor.viewState.type("x");
        const built = vi.spyOn(editor.model.document, "getText");

        const source = documentSyncSourceOfModel(editor.model);

        expect(built).not.toHaveBeenCalled();
        expect(source).toMatchObject({
            uri: editor.uri.toString(),
            languageId: "plaintext",
            version: editor.model.document.versionId,
            isDirty: true,
            length: "xalpha".length,
        });
        expect(source.getText()).toBe("xalpha");
        expect(built).toHaveBeenCalledTimes(1);
    });

    it("bindDocumentSync: didOpen per document, didChange per edit, didClose on the last tab", () => {
        const { host, opened, changed, closed } = recordingHost();
        service.openFile(ws.path("a.ts"));
        service.splitActiveGroup();
        const uri = service.getActiveEditor()!.uri.toString();

        bindDocumentSync(service, service.editorGroups, host);
        expect(opened).toEqual([uri]);

        service.getActiveEditor()!.viewState.type("x");
        expect(changed).toEqual([uri]);

        service.editorGroups.activeGroup.closeTab(0);
        expect(closed).toEqual([]);

        service.editorGroups.activeGroup.closeTab(0);
        expect(closed).toEqual([uri]);
        expect(opened).toEqual([uri]);
    });

    it("bindDocumentSync: an edit is the model batch delta with version and dirty, synchronously", () => {
        const { host, deltas, flushes } = recordingHost();
        service.openFile(ws.path("a.ts"));
        const editor = service.getActiveEditor()!;
        bindDocumentSync(service, service.editorGroups, host);

        editor.viewState.type("x");

        expect(flushes).toEqual([]);
        expect(deltas).toEqual([
            {
                uri: editor.uri.toString(),
                version: editor.model.document.versionId,
                changes: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "x" }],
                isDirty: true,
            },
        ]);
    });

    it("bindDocumentSync: reload from disk is a full snapshot with new text and a bumped version", () => {
        const { host, deltas, flushes } = recordingHost();
        service.openFile(ws.path("a.ts"));
        const editor = service.getActiveEditor()!;
        editor.viewState.type("x");
        bindDocumentSync(service, service.editorGroups, host);
        editor.viewState.type("y");
        const versionBefore = deltas.at(-1)!.version;

        ws.writeFile("a.ts", "from disk");
        editor.revertToDisk();

        expect(flushes.at(-1)?.getText()).toBe("from disk");
        expect(flushes.at(-1)!.version).toBeGreaterThan(versionBefore);
    });

    it("bindDocumentSync: Save As to a new uri of the same language closes the old and opens the new", async () => {
        const { host, opened, closed } = recordingHost();
        service.openFile(ws.path("a.ts"));
        const editor = service.getActiveEditor()!;
        const oldUri = editor.uri.toString();
        bindDocumentSync(service, service.editorGroups, host);

        await editor.saveAs(ws.path("renamed.ts"));

        const newUri = editor.uri.toString();
        expect(closed).toEqual([oldUri]);
        expect(opened).toEqual([oldUri, newUri]);

        service.editorGroups.activeGroup.closeTab(0);
        expect(closed).toEqual([oldUri, newUri]);
    });

    it("bindDocumentSync: a language change without a uri change reopens the document with the new language", () => {
        const opened: IDocumentSyncSource[] = [];
        const closed: string[] = [];
        const host: IDocumentSyncTarget = {
            didOpenTextDocument: (source) => opened.push(source),
            didChangeTextDocument: () => undefined,
            didChangeTextDocumentContent: () => undefined,
            didCloseTextDocument: (uri) => closed.push(uri),
            didChangeTextDocumentState: () => undefined,
        };
        service.openFile(ws.path("a.ts"));
        const editor = service.getActiveEditor()!;
        const uri = editor.uri.toString();
        bindDocumentSync(service, service.editorGroups, host);

        editor.model.setLanguage("javascript");

        expect(closed).toEqual([uri]);
        expect(opened.map((s) => [s.uri, s.languageId])).toEqual([
            [uri, "plaintext"],
            [uri, "javascript"],
        ]);

        service.openFile(ws.path("b.ts"));
        expect(closed).toEqual([uri]);
    });

    it("bindDocumentSync: a closed document drops its listeners on a model that outlived the tab", () => {
        const { host, opened, changed, closed } = recordingHost();
        service.openFile(ws.path("a.ts"));
        const editor = service.getActiveEditor()!;
        // Another reference (as a workspace edit holds) keeps the model alive after the tab.
        const reference = service.textFileModels.acquire(editor.uri);
        bindDocumentSync(service, service.editorGroups, host);
        service.editorGroups.activeGroup.closeTab(0);
        expect(closed).toHaveLength(1);

        reference.model.setLanguage("javascript");
        reference.model.document.applyEdits([{ range: createRange(0, 0, 0, 0), text: "x" }]);

        expect(closed).toHaveLength(1);
        expect(opened).toHaveLength(1);
        expect(changed).toEqual([]);
        reference.dispose();
    });

    it("bindDocumentSync: opening a new file after binding fires didOpen", () => {
        const { host, opened } = recordingHost();
        service.openFile(ws.path("a.ts"));
        bindDocumentSync(service, service.editorGroups, host);

        service.openFile(ws.path("b.ts"));
        expect(opened).toHaveLength(2);
    });

    describe("the large-file mode", () => {
        let large: EditorService;

        beforeEach(() => {
            ws.writeFile("big.log", "1\n2\n3\n4");
            large = new EditorService(
                new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
                new TokenizationRegistry(),
                NULL_TOKEN_STYLE_RESOLVER,
                NULL_LANGUAGE_SERVICE,
                createTestConfigurationService({ "editor.largeFileLineCountThreshold": 2 }),
                new UndoRedoService(),
                NULL_FILE_WATCHER,
                createTestEditorContextMenuController(),
                NULL_LOG_SERVICE,
                undefined,
                undefined,
                [],
                undefined,
                diskFileService(),
            );
        });

        afterEach(() => {
            large.dispose();
        });

        it("the source carries the mode, and leaving it is a flush the host opens the document on", () => {
            const { host, opened, flushes } = recordingHost();
            large.openFile(ws.path("big.log"));
            const editor = large.getActiveEditor()!;
            expect(editor.model.isTooLargeForTokenization).toBe(true);

            bindDocumentSync(large, large.editorGroups, host);
            // The adapter hands every document over; the host decides by the flag (documentsCustomer).
            expect(opened).toEqual([editor.uri.toString()]);
            expect(documentSyncSourceOfModel(editor.model).isTooLargeForTokenization).toBe(true);

            editor.model.forcefullyEnableFeatures();
            expect(flushes.map((f) => [f.uri, f.isTooLargeForTokenization])).toEqual([[editor.uri.toString(), false]]);
            expect(flushes[0].getText()).toBe("1\n2\n3\n4");
        });
    });
});
