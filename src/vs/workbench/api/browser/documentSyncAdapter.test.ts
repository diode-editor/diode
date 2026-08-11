import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NULL_LOG_SERVICE } from "../../../platform/log/common/nullLogService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { createTestEditorContextMenuController } from "../../../../TestUtils/testEditorContextMenu.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../platform/files/common/iFileWatcher.ts";
import { WorkbenchTheme } from "../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";
import { EditorService } from "../../services/editor/browser/editorService.ts";
import type { ExtensionHost } from "../../services/extensions/node/extensionHost.ts";
import { darkPlusTheme } from "../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../services/themes/common/themeService.ts";
import type { IWireDocumentSyncSnapshot } from "../common/wireTypes.ts";

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
            prefix: "vexx-docsync-adapter-",
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
        host: ExtensionHost;
        opened: string[];
        changed: string[];
        closed: string[];
    } {
        const opened: string[] = [];
        const changed: string[] = [];
        const closed: string[] = [];
        const host = {
            didOpenTextDocument: (snapshot: IWireDocumentSyncSnapshot) => opened.push(snapshot.uri),
            didChangeTextDocument: (snapshot: IWireDocumentSyncSnapshot) => changed.push(snapshot.uri),
            didCloseTextDocument: (uri: string) => closed.push(uri),
        } as unknown as ExtensionHost;
        return { host, opened, changed, closed };
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

        bindDocumentSync(service, host);
        // Документ открыт в двух группах — один didOpen, не два.
        expect(opened).toEqual([uri]);

        service.getActiveEditor()!.viewState.type("x");
        expect(changed).toEqual([uri]);

        // Закрытие дубля: документ жив в первой группе — didClose не шлётся.
        service.activeGroup.closeTab(0);
        expect(closed).toEqual([]);

        // Закрытие последней вкладки документа — didClose.
        service.activeGroup.closeTab(0);
        expect(closed).toEqual([uri]);
        expect(opened).toEqual([uri]); // повторных didOpen не было
    });

    it("bindDocumentSync: открытие нового файла после привязки даёт didOpen", () => {
        const { host, opened } = recordingHost();
        service.openFile(ws.path("a.ts"));
        bindDocumentSync(service, host);

        service.openFile(ws.path("b.ts"));
        expect(opened).toHaveLength(2);
    });
});
