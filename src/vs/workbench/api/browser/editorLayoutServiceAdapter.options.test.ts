import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../../TestUtils/testConfigurationService.ts";
import { createTestEditorContextMenuController } from "../../../../TestUtils/testEditorContextMenu.ts";
import { flushMicrotasks } from "../../../../TestUtils/timing.ts";
import { Uri } from "../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../editor/common/languages/tokenizationRegistry.ts";
import type { InMemoryConfigurationService } from "../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";
import { TextEditorPane } from "../../browser/parts/editor/textEditorPane.ts";
import { DialogService } from "../../services/dialogs/browser/dialogService.ts";
import { EditorService } from "../../services/editor/browser/editorService.ts";
import { darkPlusTheme } from "../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../services/themes/common/themeService.ts";
import type { IWireEditorPropertiesChanged } from "../common/wireTypes.ts";

import { EditorLayoutServiceAdapter } from "./editorLayoutServiceAdapter.ts";

const LINE = 1;
const BLOCK = 2;
const UNDERLINE_THIN = 6;

/** Who sends `editor.propertiesChanged` with `options`, and on what (#1231). */
describe("EditorLayoutServiceAdapter — editor options", () => {
    let ws: ITempWorkspace;
    let configuration: InMemoryConfigurationService;
    let service: EditorService;
    let adapter: EditorLayoutServiceAdapter;
    let reports: IWireEditorPropertiesChanged[];

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-layout-options-", files: { "a.txt": "a\n", "b.txt": "b\n" } });
        configuration = createTestConfigurationService({ "editor.tabSize": 4, "editor.insertSpaces": true });
        const dialogs = new DialogService();
        dialogs.attachHost(new BodyElement());
        service = new EditorService(
            new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
            new TokenizationRegistry(),
            NULL_TOKEN_STYLE_RESOLVER,
            NULL_LANGUAGE_SERVICE,
            configuration,
            new UndoRedoService(),
            NULL_FILE_WATCHER,
            createTestEditorContextMenuController(),
            NULL_LOG_SERVICE,
            undefined,
            dialogs,
        );
        adapter = new EditorLayoutServiceAdapter(service, service.editorGroups);
        reports = [];
        adapter.onDidChangeEditorProperties((properties) => reports.push(properties));
    });

    afterEach(() => {
        adapter.dispose();
        service.dispose();
        ws.dispose();
    });

    function uriOf(name: string): string {
        return Uri.file(ws.path(name)).toString();
    }

    /** Opened and its first report taken. */
    async function open(name: string): Promise<TextEditorPane> {
        service.openFile(ws.path(name));
        const pane = service.getActiveTabEditor();
        if (pane === null) throw new Error("no editor");
        await flushMicrotasks();
        reports.length = 0;
        return pane;
    }

    function optionReports(): unknown[] {
        return reports.filter((report) => report.options !== undefined);
    }

    it("a newly visible editor reports no options, as upstream's new editor arrives with its own", async () => {
        service.openFile(ws.path("a.txt"));
        await flushMicrotasks();
        expect(reports).toHaveLength(1);
        expect(optionReports()).toEqual([]);
    });

    it("an indentation change reports all options and nothing else", async () => {
        const pane = await open("a.txt");
        pane.setIndentOptions({ tabSize: 2 });
        await flushMicrotasks();
        expect(reports).toEqual([
            {
                uri: uriOf("a.txt"),
                groupId: service.editorGroups.groups[0].id,
                options: { tabSize: 2, insertSpaces: true, cursorStyle: LINE },
            },
        ]);
    });

    it("editor.tabSize and editor.insertSpaces in the settings report", async () => {
        await open("a.txt");
        void configuration.updateValue("editor.insertSpaces", false);
        await flushMicrotasks();
        expect(optionReports()).toEqual([
            expect.objectContaining({ options: { tabSize: 4, insertSpaces: false, cursorStyle: LINE } }),
        ]);
    });

    it("editor.cursorStyle in the settings and an extension's override report the style as the API enum", async () => {
        const pane = await open("a.txt");
        void configuration.updateValue("editor.cursorStyle", "block");
        await flushMicrotasks();
        pane.cursorStyleOverride = "underline-thin";
        service.editorConfiguration.applyCursorStyle(pane);
        await flushMicrotasks();
        expect(optionReports().map((report) => (report as IWireEditorPropertiesChanged).options?.cursorStyle)).toEqual([
            BLOCK,
            UNDERLINE_THIN,
        ]);
    });

    it("an unchanged value reports nothing", async () => {
        const pane = await open("a.txt");
        pane.setIndentOptions({ tabSize: 4, insertSpaces: true });
        void configuration.updateValue("editor.cursorBlinking", "solid");
        await flushMicrotasks();
        expect(reports).toEqual([]);
    });

    it("a change of one editor reports only that editor: the split next to it stays silent", async () => {
        await open("a.txt");
        service.splitActiveGroup();
        await flushMicrotasks();
        const [first] = service.editorGroups.groups;
        const left = first.getPane(0) as TextEditorPane;
        reports.length = 0;

        left.setIndentOptions({ tabSize: 8 });
        await flushMicrotasks();
        expect(reports).toEqual([
            { uri: uriOf("a.txt"), groupId: first.id, options: { tabSize: 8, insertSpaces: true, cursorStyle: LINE } },
        ]);
    });

    it("a hidden editor reports nothing; shown again, it reports what changed meanwhile", async () => {
        const a = await open("a.txt");
        await open("b.txt");
        a.setIndentOptions({ tabSize: 3 });
        await flushMicrotasks();
        expect(reports).toEqual([]);

        service.editorGroups.groups[0].activateTab(0);
        await flushMicrotasks();
        expect(optionReports()).toEqual([
            expect.objectContaining({
                uri: uriOf("a.txt"),
                options: { tabSize: 3, insertSpaces: true, cursorStyle: LINE },
            }),
        ]);
    });
});
