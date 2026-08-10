import * as path from "node:path";

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
import { darkPlusTheme } from "../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../services/themes/common/themeService.ts";
import type { IWireEditorLayout } from "../common/wireTypes.ts";

import { EditorLayoutServiceAdapter } from "./editorLayoutServiceAdapter.ts";

/**
 * Продюсер снимков полосы групп для `editor.layoutChanged` + исполнение
 * `showTextDocument` (семантика ViewColumn) поверх настоящего EditorService.
 */
describe("EditorLayoutServiceAdapter", () => {
    let ws: ITempWorkspace;
    let service: EditorService;
    let adapter: EditorLayoutServiceAdapter;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "vexx-layout-adapter-",
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
        adapter = new EditorLayoutServiceAdapter(service);
    });

    afterEach(() => {
        adapter.dispose();
        service.dispose();
        ws.dispose();
    });

    it("снимок: группы с viewColumn, активная вкладка несёт selections", () => {
        service.openFile(ws.path("a.ts"));
        service.openFile(ws.path("b.ts"));
        service.splitActiveGroup();

        const layout = adapter.getLayoutSnapshot();
        expect(layout.groups.length).toBe(2);
        expect(layout.groups[0].viewColumn).toBe(1);
        expect(layout.groups[1].viewColumn).toBe(2);
        expect(layout.groups[1].isActive).toBe(true);
        // Группа 1: a + b; активная вкладка b несёт выделения, неактивная — нет.
        const tabs = layout.groups[0].tabs;
        expect(tabs.map((tab) => path.basename(tab.uri))).toEqual(["a.ts", "b.ts"]);
        expect(tabs[0].selections).toBeUndefined();
        expect(tabs[1].isActive).toBe(true);
        expect(tabs[1].selections).toBeDefined();
        expect(tabs[1].kind).toBe("text");
    });

    it("продюсер: сплит/смена вкладки коалесируются в один снимок за тик", async () => {
        service.openFile(ws.path("a.ts"));
        const pushes: IWireEditorLayout[] = [];
        adapter.onDidChangeLayout((layout) => pushes.push(layout));

        service.openFile(ws.path("b.ts"));
        service.splitActiveGroup();
        await Promise.resolve();

        expect(pushes.length).toBe(1);
        expect(pushes[0].groups.length).toBe(2);
    });

    it("flushPendingLayout доставляет отложенный снимок синхронно (инвариант перед метой)", () => {
        service.openFile(ws.path("a.ts"));
        const pushes: IWireEditorLayout[] = [];
        adapter.onDidChangeLayout((layout) => pushes.push(layout));

        service.splitActiveGroup();
        expect(pushes.length).toBe(0); // ещё в микротаске
        adapter.flushPendingLayout();
        expect(pushes.length).toBe(1);
        // Повторный флаш без изменений — no-op.
        adapter.flushPendingLayout();
        expect(pushes.length).toBe(1);
    });

    it("showTextDocument: Active — активная группа; повторное открытие — дедуп", async () => {
        service.openFile(ws.path("a.ts"));

        const result = await adapter.showTextDocument({ uri: service.getActiveEditor()!.uri.toString() });
        expect(result.viewColumn).toBe(1);
        expect(service.activeGroup.editorCount).toBe(1);
    });

    it("showTextDocument: Beside создаёт соседнюю группу; за сеткой — догоняющее создание (AS-5)", async () => {
        service.openFile(ws.path("a.ts"));
        const uriB = service.getActiveEditor()!.uri.toString().replace("a.ts", "b.ts");

        const beside = await adapter.showTextDocument({ uri: uriB, viewColumn: -2 });
        expect(beside.viewColumn).toBe(2);
        expect(service.groups.length).toBe(2);

        // ViewColumn.Three при двух группах — создаётся третья.
        const third = await adapter.showTextDocument({ uri: uriB, viewColumn: 3 });
        expect(third.viewColumn).toBe(3);
        expect(service.groups.length).toBe(3);
    });

    it("showTextDocument: preserveFocus не передаёт фокус, selection ставит каретку", async () => {
        ws.writeFile("long.ts", Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n"));
        service.openFile(ws.path("a.ts"));
        const before = service.activeGroup;

        await adapter.showTextDocument({
            uri: service.getActiveEditor()!.uri.toString().replace("a.ts", "long.ts"),
            preserveFocus: true,
            selection: { anchorLine: 5, anchorCharacter: 1, activeLine: 5, activeCharacter: 1 },
        });

        expect(service.activeGroup === before).toBe(true);
        expect(service.getActiveEditor()!.viewState.selections[0].active).toEqual({ line: 5, character: 1 });
    });

    it("closeTabs закрывает чистую вкладку; умершая группа — идемпотентный успех", async () => {
        service.openFile(ws.path("a.ts"));
        service.splitActiveGroup();
        const group = service.activeGroup;
        const uri = group.activePane!.uri.toString();

        await expect(adapter.closeTabs({ tabs: [{ groupId: group.id, uri }] })).resolves.toBe(true);
        // Группа схлопнулась; повторное закрытие — успех.
        expect(service.groups.length).toBe(1);
        await expect(adapter.closeTabs({ tabs: [{ groupId: group.id, uri }] })).resolves.toBe(true);
    });

    it("closeGroups закрывает вкладки группы целиком", async () => {
        service.openFile(ws.path("a.ts"));
        service.splitActiveGroup();
        service.openFile(ws.path("b.ts"));
        const group = service.activeGroup;
        expect(group.editorCount).toBe(2);

        await expect(adapter.closeGroups({ groupIds: [group.id] })).resolves.toBe(true);
        expect(service.groups.length).toBe(1);
    });

    it("closeTabs с несохранённой последней вкладкой документа — false, вкладка на месте", async () => {
        service.openFile(ws.path("a.ts"));
        const editor = service.getActiveEditor()!;
        editor.viewState.type("dirty");
        const group = service.activeGroup;

        await expect(
            adapter.closeTabs({ tabs: [{ groupId: group.id, uri: editor.uri.toString() }] }),
        ).resolves.toBe(false);
        expect(group.editorCount).toBe(1);
    });
});
