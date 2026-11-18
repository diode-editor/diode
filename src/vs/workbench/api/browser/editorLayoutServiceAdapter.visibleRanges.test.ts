import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { createTestEditorContextMenuController } from "../../../../TestUtils/testEditorContextMenu.ts";
import { flushMicrotasks } from "../../../../TestUtils/timing.ts";
import { Uri } from "../../../base/common/uri.ts";
import { createRange } from "../../../editor/common/core/iRange.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";
import { DiffEditorPane2 } from "../../browser/parts/editor/diffEditorPane2.ts";
import { TextEditorPane } from "../../browser/parts/editor/textEditorPane.ts";
import { DialogService } from "../../services/dialogs/browser/dialogService.ts";
import { EditorService } from "../../services/editor/browser/editorService.ts";
import { darkPlusTheme } from "../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../services/themes/common/themeService.ts";
import type { IWireEditorPropertiesChanged } from "../common/wireTypes.ts";

import { EditorLayoutServiceAdapter } from "./editorLayoutServiceAdapter.ts";

/** Line `i` is `line i`: 6 characters below 10, 7 from 10 up. */
const HUNDRED_LINES = Array.from({ length: 100 }, (_, i) => `line ${String(i)}`).join("\n");

describe("EditorLayoutServiceAdapter — visible ranges", () => {
    let ws: ITempWorkspace;
    let service: EditorService;
    let adapter: EditorLayoutServiceAdapter;
    let reports: IWireEditorPropertiesChanged[];

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-layout-ranges-",
            files: { "a.txt": HUNDRED_LINES, "b.txt": HUNDRED_LINES },
        });
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

    /** Opened, laid out 10 rows high and its first report taken. */
    async function open(name: string): Promise<TextEditorPane> {
        service.openFile(ws.path(name));
        const pane = service.getActiveTabEditor();
        if (pane === null) throw new Error("no editor");
        pane.viewState.viewportHeight = 10;
        await flushMicrotasks();
        reports.length = 0;
        return pane;
    }

    it("the snapshot seeds the active tab, not a background one", async () => {
        await open("a.txt");
        await open("b.txt");

        const [background, active] = adapter.getLayoutSnapshot().groups[0].tabs;
        expect(background.visibleRanges).toBeUndefined();
        expect(active.visibleRanges).toEqual([createRange(0, 0, 9, 6)]);
    });

    it("a scroll reports the new ranges once per tick, with the editor's address", async () => {
        const pane = await open("a.txt");

        pane.viewState.scrollTop = 5;
        pane.viewState.scrollTop = 20;
        await flushMicrotasks();

        expect(reports).toEqual([
            {
                uri: uriOf("a.txt"),
                groupId: service.editorGroups.groupOf(pane)?.id,
                visibleRanges: [createRange(20, 0, 29, 7)],
            },
        ]);
    });

    it("an unchanged value reports nothing", async () => {
        const pane = await open("a.txt");

        pane.viewState.scrollTop = 20;
        pane.viewState.scrollTop = 0;
        await flushMicrotasks();

        expect(reports).toEqual([]);
    });

    it("a fold inside the screen splits the ranges", async () => {
        const pane = await open("a.txt");

        pane.viewState.setFoldingRegions([{ startLine: 2, endLine: 4, isCollapsed: true }]);
        await flushMicrotasks();

        expect(reports.map((report) => report.visibleRanges)).toEqual([
            [createRange(0, 0, 2, 6), createRange(5, 0, 11, 7)],
        ]);
    });

    it("an edit from another editor of the document reports without a scroll", async () => {
        const left = await open("b.txt");
        service.splitActiveGroup();
        const right = service.getActiveTabEditor();
        if (right === null) throw new Error("no editor");
        right.viewState.viewportHeight = 10;
        right.viewState.goToPosition(9, 6);
        await flushMicrotasks();
        reports.length = 0;

        right.viewState.type("!");
        await flushMicrotasks();

        const leftReport = reports.find((report) => report.groupId === service.editorGroups.groupOf(left)?.id);
        expect(left.viewState.scrollTop).toBe(0);
        expect(leftReport?.visibleRanges).toEqual([createRange(0, 0, 9, 7)]);
    });

    it("the editor of an inactive group reports too", async () => {
        const left = await open("a.txt");
        service.splitActiveGroup();
        await flushMicrotasks();
        reports.length = 0;

        left.viewState.scrollTop = 30;
        await flushMicrotasks();

        expect(service.editorGroups.activeGroup).not.toBe(service.editorGroups.groupOf(left));
        expect(reports).toEqual([
            {
                uri: uriOf("a.txt"),
                groupId: service.editorGroups.groupOf(left)?.id,
                visibleRanges: [createRange(30, 0, 39, 7)],
            },
        ]);
    });

    it("a newly visible editor reports, a hidden one stays quiet", async () => {
        const first = await open("a.txt");

        first.viewState.scrollTop = 40;
        service.openFile(ws.path("b.txt"));
        await flushMicrotasks();

        expect(reports.map((report) => report.uri)).toEqual([uriOf("b.txt")]);
    });

    it("both sides of a diff report under the diff's group", async () => {
        const shared = service.textFileModels.acquire(Uri.file(ws.path("a.txt")));
        const owned = service.textFileModels.createUntitledModel();
        const diff = new DiffEditorPane2(
            NULL_LANGUAGE_SERVICE,
            new UndoRedoService(),
            diskFileService(),
            new TokenizationRegistry(),
            NULL_TOKEN_STYLE_RESOLVER,
            {
                uri: Uri.parse("diode-diff:/a.txt?pair"),
                label: "pair",
                originalLabel: "a.txt",
                modifiedLabel: "Untitled",
                original: { kind: "shared", ref: shared },
                modified: { kind: "owned", model: owned },
                languageId: "plaintext",
            },
        );
        service.openPane(diff);
        await flushMicrotasks();
        const groupId = service.editorGroups.activeGroup.id;
        const [original, modified] = diff.sidePanes();

        expect(reports.map((report) => [report.uri, report.groupId])).toEqual([
            [uriOf("a.txt"), groupId],
            [owned.uri.toString(), groupId],
        ]);
        const tab = adapter.getLayoutSnapshot().groups[0].tabs[0];
        expect(tab.sideVisibleRanges).toEqual([
            original.viewState.getVisibleRanges(),
            modified.viewState.getVisibleRanges(),
        ]);
    });
});
