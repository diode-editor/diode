import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { createTestEditorContextMenuController } from "../../../../TestUtils/testEditorContextMenu.ts";
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

/**
 * Пер-документный продюсер document sync поверх настоящего EditorService:
 * документ (модель), а не вкладка — единица didOpen/didChange/didClose.
 */
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
        );
    });

    afterEach(() => {
        service.dispose();
        ws.dispose();
    });

    /** Host-стаб: записывает push'и вместо RPC в субпроцесс. */
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
        service.splitActiveGroup(); // дубль вкладки — та же модель
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
        // Документ открыт в двух группах — один didOpen, не два.
        expect(opened).toEqual([uri]);

        service.getActiveEditor()!.viewState.type("x");
        expect(changed).toEqual([uri]);

        // Закрытие дубля: документ жив в первой группе — didClose не шлётся.
        service.editorGroups.activeGroup.closeTab(0);
        expect(closed).toEqual([]);

        // Закрытие последней вкладки документа — didClose.
        service.editorGroups.activeGroup.closeTab(0);
        expect(closed).toEqual([uri]);
        expect(opened).toEqual([uri]); // повторных didOpen не было
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

        // Хост узнаёт о перечитке снапшотом: текст с диска, версия не откатилась.
        expect(flushes.at(-1)?.text).toBe("from disk");
        expect(flushes.at(-1)!.version).toBeGreaterThan(versionBefore);
    });

    it("bindDocumentSync: открытие нового файла после привязки даёт didOpen", () => {
        const { host, opened } = recordingHost();
        service.openFile(ws.path("a.ts"));
        bindDocumentSync(service, service.editorGroups, host);

        service.openFile(ws.path("b.ts"));
        expect(opened).toHaveLength(2);
    });
});
