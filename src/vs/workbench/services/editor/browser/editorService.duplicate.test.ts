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

import { EditorService, EditorServiceDIToken } from "./editorService.ts";

/**
 * Сплит и копия в группу повторяют вкладку по её рецепту (фабрика вкладок
 * её вида), а не только файловую: недисковый ресурс (`jdt:`) тоже переезжает,
 * безымянный буфер — нет.
 */
describe("EditorService — повтор вкладки по рецепту (сплит, копия в группу)", () => {
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
        const pane = service.groups[index].activePane;
        expect(pane instanceof TextEditorPane).toBe(true);
        return pane as TextEditorPane;
    };

    function provideJdt(text = "class Lib {}\nint x;\n") {
        const provide = vi.fn<(uri: Uri) => Promise<string | null>>().mockResolvedValue(text);
        service.virtualDocumentSource = { canProvide: (scheme) => scheme === "jdt", provide };
        return provide;
    }

    it("сплит jdt:-вкладки открывает её же в новой группе с той же кареткой", async () => {
        const provide = provideJdt();
        await service.openUri(JDT);
        textPaneOf(0).viewState.selections = [createCursorSelection(1, 3)];

        const group = service.splitActiveGroup();
        await vi.waitFor(() => {
            expect(group?.editorCount).toBe(1);
        });

        expect(service.activeGroup).toBe(group);
        expect(textPaneOf(1).uri.toString()).toBe(JDT.toString());
        expect(textPaneOf(1).getText()).toBe("class Lib {}\nint x;\n");
        expect(textPaneOf(1).viewState.selections).toEqual([createCursorSelection(1, 3)]);
        expect(provide).toHaveBeenCalledTimes(2);
    });

    it("сплит jdt:-вкладки без провайдера схемы — новая группа пустая, как у untitled", async () => {
        provideJdt();
        await service.openUri(JDT);
        service.virtualDocumentSource = { canProvide: () => false, provide: () => Promise.resolve(null) };

        const group = service.splitActiveGroup();

        expect(group?.editorCount).toBe(0);
        expect(service.activeGroup).toBe(group);
        expect(service.getActiveTabPane()).toBeNull();
    });

    it("копия jdt:-вкладки в соседнюю группу", async () => {
        provideJdt();
        await service.openUri(JDT);

        service.copyActiveEditorToGroup("next");
        await vi.waitFor(() => {
            expect(service.groups.at(1)?.editorCount).toBe(1);
        });

        expect(service.groups[0].editorCount).toBe(1);
        expect(textPaneOf(1).uri.toString()).toBe(JDT.toString());
    });

    it("копия безымянного буфера — no-op: ни группы, ни вкладки", () => {
        service.newUntitled();

        service.copyActiveEditorToGroup("next");

        expect(service.groups.length).toBe(1);
        expect(service.activeGroup.editorCount).toBe(1);
    });

    it("сплит вкладки, которую не повторить, — активного редактора больше нет, и это событие", () => {
        service.newUntitled();
        const events: unknown[] = [];
        service.onActiveEditorChanged((editor) => events.push(editor));

        service.splitActiveGroup();

        expect(events.at(-1)).toBeNull();
    });

    it("копия из пустой группы — no-op", () => {
        service.copyActiveEditorToGroup("next");

        expect(service.groups.length).toBe(1);
    });

    it("openUri в явную группу: вкладка там, каретка из viewState", async () => {
        service.openFile(ws.path("a.txt"));
        const right = service.newGroup("after", { focus: false })!;
        service.focusGroup({ index: 0 });

        await service.openUri(Uri.file(ws.path("a.txt")), {
            group: right,
            viewState: { selections: [createCursorSelection(2, 1)], scrollTop: 0, scrollLeft: 0 },
        });

        expect(service.activeGroup).toBe(right);
        expect(right.editorCount).toBe(1);
        expect(textPaneOf(1).viewState.selections).toEqual([createCursorSelection(2, 1)]);
        // Вкладка источника своей каретки не потеряла.
        expect(textPaneOf(0).viewState.selections).toEqual([createCursorSelection(0, 0)]);
    });

    it("openUri с viewState уже открытой вкладки её каретку не трогает", async () => {
        service.openFile(ws.path("a.txt"));
        textPaneOf(0).viewState.selections = [createCursorSelection(1, 1)];

        await service.openUri(Uri.file(ws.path("a.txt")), {
            viewState: { selections: [createCursorSelection(2, 2)], scrollTop: 0, scrollLeft: 0 },
        });

        expect(service.activeGroup.editorCount).toBe(1);
        expect(textPaneOf(0).viewState.selections).toEqual([createCursorSelection(1, 1)]);
    });
});

describe("EditorService — повтор вкладки без фокуса", () => {
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

    it("split с focus: false — копия в новой группе, фокус остаётся в источнике", () => {
        const service = h.container.get(EditorServiceDIToken);
        const focused = h.testApp.focusedElement;
        expect(focused).not.toBeNull();

        service.splitActiveGroup({ focus: false });

        expect(service.groups[1].editorCount).toBe(1);
        expect(h.testApp.focusedElement).toBe(focused);
    });

    it("copy с focus: false — копия в соседней группе, фокус остаётся в источнике", () => {
        const service = h.container.get(EditorServiceDIToken);
        const focused = h.testApp.focusedElement;

        service.copyActiveEditorToGroup("next", { focus: false });

        expect(service.groups[1].editorCount).toBe(1);
        expect(h.testApp.focusedElement).toBe(focused);
    });

    it("сплит вкладки не текстового вида (Keyboard Shortcuts) — новая группа пустая", () => {
        const service = h.container.get(EditorServiceDIToken);
        // Провайдер на любую схему: текстовая фабрика отказывается по виду
        // вкладки, а не потому, что её схему никто не обслуживает.
        service.virtualDocumentSource = { canProvide: () => true, provide: () => Promise.resolve("x\n") };
        h.commands.execute("workbench.action.openGlobalKeybindings");

        const group = service.splitActiveGroup();

        expect(group?.editorCount).toBe(0);
    });
});
