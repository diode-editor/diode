import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
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
import type { IDocumentSyncTarget } from "../common/iDocumentSyncTarget.ts";
import type { IWireDocumentChangedEvent, IWireDocumentSyncSnapshot } from "../common/wireTypes.ts";

import { bindDocumentSync, openDocumentSnapshots } from "./documentSyncAdapter.ts";

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
        flushes: IWireDocumentSyncSnapshot[];
        closed: string[];
    } {
        const opened: string[] = [];
        const changed: string[] = [];
        const deltas: IWireDocumentChangedEvent[] = [];
        const flushes: IWireDocumentSyncSnapshot[] = [];
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
        };
        return { host, opened, changed, deltas, flushes, closed };
    }

    it("openDocumentSnapshots: документ в двух группах даёт один снапшот", () => {
        service.openFile(ws.path("a.ts"));
        service.splitActiveGroup();
        service.openFile(ws.path("b.ts"));

        const snapshots = openDocumentSnapshots(service);
        expect(snapshots.map((s) => s.text)).toEqual(["alpha", "beta"]);
    });

    it("bindDocumentSync: didOpen по документу, didChange на правку, didClose — по последней вкладке", () => {
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

    it("bindDocumentSync: правка — дельта батча модели с версией и dirty, синхронно", () => {
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

    it("bindDocumentSync: перечитка с диска — полный снапшот с новым текстом и растущей версией", () => {
        const { host, deltas, flushes } = recordingHost();
        service.openFile(ws.path("a.ts"));
        const editor = service.getActiveEditor()!;
        editor.viewState.type("x");
        bindDocumentSync(service, service.editorGroups, host);
        editor.viewState.type("y");
        const versionBefore = deltas.at(-1)!.version;

        ws.writeFile("a.ts", "from disk");
        editor.revertToDisk();

        expect(flushes.at(-1)?.text).toBe("from disk");
        expect(flushes.at(-1)!.version).toBeGreaterThan(versionBefore);
    });

    it("bindDocumentSync: Save As в новый uri того же языка — didClose старого и didOpen нового", async () => {
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

    it("bindDocumentSync: смена языка без смены uri — переоткрытие документа с новым языком", () => {
        const opened: IWireDocumentSyncSnapshot[] = [];
        const closed: string[] = [];
        const host: IDocumentSyncTarget = {
            didOpenTextDocument: (snapshot) => opened.push(snapshot),
            didChangeTextDocument: () => undefined,
            didChangeTextDocumentContent: () => undefined,
            didCloseTextDocument: (uri) => closed.push(uri),
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

    it("bindDocumentSync: закрытый документ снимает подписки на модель, пережившую вкладку", () => {
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

    it("bindDocumentSync: открытие нового файла после привязки даёт didOpen", () => {
        const { host, opened } = recordingHost();
        service.openFile(ws.path("a.ts"));
        bindDocumentSync(service, service.editorGroups, host);

        service.openFile(ws.path("b.ts"));
        expect(opened).toHaveLength(2);
    });
});
