import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";
import { EditorServiceDIToken } from "../common/editorService.ts";

import { EditorService } from "./editorService.ts";

describe("EditorService — duplicating a tab from its recipe (split, copy to group)", () => {
    let ws: ITempWorkspace;
    let service: EditorService;
    const JDT = Uri.parse("jdt://contents/lib.jar/org.example/Lib.java");

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-duplicate-", files: { "a.txt": "one\ntwo\nthree\n" } });
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

    const textPaneOf = (index: number): TextEditorPane => {
        const pane = service.editorGroups.groups[index].activePane;
        expect(pane instanceof TextEditorPane).toBe(true);
        return pane as TextEditorPane;
    };

    function provideJdt(text = "class Lib {}\nint x;\n") {
        const provide = vi.fn<(uri: Uri) => Promise<string | null>>().mockResolvedValue(text);
        service.virtualDocumentSource = { canProvide: (scheme) => scheme === "jdt", provide };
        return provide;
    }

    it("splitting a jdt: tab opens it in a new group with the same cursor", async () => {
        const provide = provideJdt();
        await service.openUri(JDT);
        textPaneOf(0).viewState.selections = [createCursorSelection(1, 3)];

        const group = service.splitActiveGroup();
        await vi.waitFor(() => {
            expect(group?.editorCount).toBe(1);
        });

        expect(service.editorGroups.activeGroup).toBe(group);
        expect(textPaneOf(1).uri.toString()).toBe(JDT.toString());
        expect(textPaneOf(1).getText()).toBe("class Lib {}\nint x;\n");
        expect(textPaneOf(1).viewState.selections).toEqual([createCursorSelection(1, 3)]);
        expect(provide).toHaveBeenCalledTimes(2);
    });

    it("splitting a jdt: tab without a scheme provider leaves the new group empty, as for untitled", async () => {
        provideJdt();
        await service.openUri(JDT);
        service.virtualDocumentSource = { canProvide: () => false, provide: () => Promise.resolve(null) };

        const group = service.splitActiveGroup();

        expect(group?.editorCount).toBe(0);
        expect(service.editorGroups.activeGroup).toBe(group);
        expect(service.getActiveTabPane()).toBeNull();
    });

    it("copying a jdt: tab to the neighbouring group", async () => {
        provideJdt();
        await service.openUri(JDT);

        service.copyActiveEditorToGroup("next");
        await vi.waitFor(() => {
            expect(service.editorGroups.groups.at(1)?.editorCount).toBe(1);
        });

        expect(service.editorGroups.groups[0].editorCount).toBe(1);
        expect(textPaneOf(1).uri.toString()).toBe(JDT.toString());
    });

    it("copying an untitled buffer is a no-op: no group, no tab", () => {
        service.newUntitled();

        service.copyActiveEditorToGroup("next");

        expect(service.editorGroups.groups.length).toBe(1);
        expect(service.editorGroups.activeGroup.editorCount).toBe(1);
    });

    it("splitting a tab that cannot be duplicated: no active editor anymore, and that is an event", () => {
        service.newUntitled();
        const events: unknown[] = [];
        service.onActiveEditorChanged((editor) => events.push(editor));

        service.splitActiveGroup();

        expect(events.at(-1)).toBeNull();
    });

    it("a session entry of another kind or a non-file for the text factory opens nothing", () => {
        const target = { group: service.editorGroups.activeGroup, focus: false };

        const notAFile = {
            typeId: "workbench.editors.files.fileEditorInput",
            value: Uri.from({ scheme: "untitled", path: ws.path("a.txt") }).toString(),
        };

        service.openSerializedEditor({ typeId: "workbench.editors.fromTheFuture", value: "x" }, target);
        service.openSerializedEditor(notAFile, target);

        expect(service.editorGroups.activeGroup.editorCount).toBe(0);
        // The path exists, but it isn't file:, which the text factory neither writes nor reads.
        expect(service.deserializeEditor(notAFile)).toBeUndefined();
    });

    it("copying from an empty group is a no-op", () => {
        service.copyActiveEditorToGroup("next");

        expect(service.editorGroups.groups.length).toBe(1);
    });

    it("openUri into an explicit group: the tab is there, the cursor from viewState", async () => {
        service.openFile(ws.path("a.txt"));
        const right = service.editorGroups.newGroup("after", { focus: false })!;
        service.editorGroups.focusGroup({ index: 0 });

        await service.openUri(Uri.file(ws.path("a.txt")), {
            group: right,
            viewState: { selections: [createCursorSelection(2, 1)], scrollTop: 0, scrollLeft: 0 },
        });

        expect(service.editorGroups.activeGroup).toBe(right);
        expect(right.editorCount).toBe(1);
        expect(textPaneOf(1).viewState.selections).toEqual([createCursorSelection(2, 1)]);
        expect(textPaneOf(0).viewState.selections).toEqual([createCursorSelection(0, 0)]);
    });

    it("openUri with viewState for an already open tab leaves its cursor alone", async () => {
        service.openFile(ws.path("a.txt"));
        textPaneOf(0).viewState.selections = [createCursorSelection(1, 1)];

        await service.openUri(Uri.file(ws.path("a.txt")), {
            viewState: { selections: [createCursorSelection(2, 2)], scrollTop: 0, scrollLeft: 0 },
        });

        expect(service.editorGroups.activeGroup.editorCount).toBe(1);
        expect(textPaneOf(0).viewState.selections).toEqual([createCursorSelection(1, 1)]);
    });
});

describe("EditorService — duplicating a tab without focus", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-duplicate-focus-", files: { "a.txt": "a\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        h.workbench.openFile(ws.path("a.txt"));
        h.workbench.focusEditor();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("split with focus: false: the copy is in a new group, focus stays on the source", () => {
        const service = h.container.get(EditorServiceDIToken);
        const focused = h.testApp.focusedElement;
        expect(focused).not.toBeNull();

        service.splitActiveGroup({ focus: false });

        expect(service.editorGroups.groups[1].editorCount).toBe(1);
        expect(h.testApp.focusedElement).toBe(focused);
    });

    it("copy with focus: false: the copy is in the neighbouring group, focus stays on the source", () => {
        const service = h.container.get(EditorServiceDIToken);
        const focused = h.testApp.focusedElement;

        service.copyActiveEditorToGroup("next", { focus: false });

        expect(service.editorGroups.groups[1].editorCount).toBe(1);
        expect(h.testApp.focusedElement).toBe(focused);
    });

    it("Keyboard Shortcuts is one per window: split does not duplicate it, copy is a no-op", () => {
        const service = h.container.get(EditorServiceDIToken);
        // A provider for any scheme: the text factory refuses because of the tab kind,
        // not because nobody serves its scheme.
        service.virtualDocumentSource = { canProvide: () => true, provide: () => Promise.resolve("x\n") };
        h.commands.execute("workbench.action.openGlobalKeybindings");

        service.copyActiveEditorToGroup("next");
        expect(service.editorGroups.groups.length).toBe(1);

        const group = service.splitActiveGroup();
        expect(group?.editorCount).toBe(0);
    });

    it("the session stores the file and Keyboard Shortcuts, but not jdt: and untitled", async () => {
        const service = h.container.get(EditorServiceDIToken);
        service.virtualDocumentSource = { canProvide: () => true, provide: () => Promise.resolve("x\n") };
        await service.openUri(Uri.parse("jdt://contents/lib.jar/Lib.java"));
        service.newUntitled();
        h.commands.execute("workbench.action.openGlobalKeybindings");

        expect(service.editorGroups.activeGroup.getPanes().map((pane) => service.serializeEditor(pane))).toEqual([
            { typeId: "workbench.editors.files.fileEditorInput", value: Uri.file(ws.path("a.txt")).toString() },
            undefined,
            undefined,
            { typeId: "workbench.input.keybindings", value: "" },
        ]);
    });
});
