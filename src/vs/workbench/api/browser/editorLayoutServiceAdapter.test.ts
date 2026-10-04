import * as path from "node:path";

import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { diskFileService } from "../../../../TestUtils/diskFileService.ts";
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
import type { IDiffEditorPane2Input } from "../../browser/parts/editor/diffEditorPane2.ts";
import { DiffEditorPane2 } from "../../browser/parts/editor/diffEditorPane2.ts";
import { DialogService } from "../../services/dialogs/browser/dialogService.ts";
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
    let dialogs: DialogService;
    let adapter: EditorLayoutServiceAdapter;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-layout-adapter-",
            files: { "a.ts": "alpha", "b.ts": "beta" },
        });
        dialogs = new DialogService();
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

    it("onDidChangeLayout: повторный dispose подписки — идемпотентный no-op", () => {
        const pushes: IWireEditorLayout[] = [];
        const subscription = adapter.onDidChangeLayout((layout) => pushes.push(layout));
        subscription.dispose();
        subscription.dispose(); // слушатель уже снят — второй dispose ничего не ломает

        service.openFile(ws.path("a.ts"));
        adapter.flushPendingLayout();
        expect(pushes).toHaveLength(0);
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
        expect(service.editorGroups.activeGroup.editorCount).toBe(1);
    });

    it("showTextDocument: Beside создаёт соседнюю группу; за сеткой — догоняющее создание (AS-5)", async () => {
        service.openFile(ws.path("a.ts"));
        const uriB = service.getActiveEditor()!.uri.toString().replace("a.ts", "b.ts");

        const beside = await adapter.showTextDocument({ uri: uriB, viewColumn: -2 });
        expect(beside.viewColumn).toBe(2);
        expect(service.editorGroups.groups.length).toBe(2);

        // ViewColumn.Three при двух группах — создаётся третья.
        const third = await adapter.showTextDocument({ uri: uriB, viewColumn: 3 });
        expect(third.viewColumn).toBe(3);
        expect(service.editorGroups.groups.length).toBe(3);
    });

    it("showTextDocument: preserveFocus не передаёт фокус, selection ставит каретку", async () => {
        ws.writeFile("long.ts", Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n"));
        service.openFile(ws.path("a.ts"));
        const before = service.editorGroups.activeGroup;
        // Сам фокус живёт в дереве контролов, которого у голого сервиса нет,
        // — здесь проверяем, что флаг доезжает до двери открытия. Что он там
        // делает, закрыто `editorService.virtualDocument.test.ts`.
        const openUri = vi.spyOn(service, "openUri");

        await adapter.showTextDocument({
            uri: service.getActiveEditor()!.uri.toString().replace("a.ts", "long.ts"),
            preserveFocus: true,
            selection: { anchorLine: 5, anchorCharacter: 1, activeLine: 5, activeCharacter: 1 },
        });

        expect(openUri).toHaveBeenCalledWith(expect.anything(), { focus: false });
        expect(service.editorGroups.activeGroup === before).toBe(true);
        expect(service.getActiveEditor()!.viewState.selections[0].active).toEqual({ line: 5, character: 1 });
    });

    /**
     * Позиции приезжают от расширения и про наш текст ничего не знают: от
     * устаревшего индекса до чужой ревизии файла. Каретка за концом строки —
     * это падение первого же кадра на highlight вхождений, поэтому дверь
     * клампит, как и `editor.selections` в соседнем адаптере.
     */
    it("showTextDocument: выделение за границами документа клампится", async () => {
        ws.writeFile("short.ts", "ab\ncd");
        service.openFile(ws.path("a.ts"));

        await adapter.showTextDocument({
            uri: service.getActiveEditor()!.uri.toString().replace("a.ts", "short.ts"),
            selection: { anchorLine: -3, anchorCharacter: -7, activeLine: 99, activeCharacter: 99 },
        });

        const selection = service.getActiveEditor()!.viewState.selections[0];
        expect(selection.anchor).toEqual({ line: 0, character: 0 });
        expect(selection.active).toEqual({ line: 1, character: 2 });
    });

    it("closeTabs закрывает чистую вкладку; умершая группа — идемпотентный успех", async () => {
        service.openFile(ws.path("a.ts"));
        service.splitActiveGroup();
        const group = service.editorGroups.activeGroup;
        const uri = group.activePane!.uri.toString();

        await expect(adapter.closeTabs({ tabs: [{ groupId: group.id, uri }] })).resolves.toBe(true);
        // Группа схлопнулась; повторное закрытие — успех.
        expect(service.editorGroups.groups.length).toBe(1);
        await expect(adapter.closeTabs({ tabs: [{ groupId: group.id, uri }] })).resolves.toBe(true);
    });

    it("closeGroups закрывает вкладки группы целиком", async () => {
        service.openFile(ws.path("a.ts"));
        service.splitActiveGroup();
        service.openFile(ws.path("b.ts"));
        const group = service.editorGroups.activeGroup;
        expect(group.editorCount).toBe(2);

        await expect(adapter.closeGroups({ groupIds: [group.id] })).resolves.toBe(true);
        expect(service.editorGroups.groups.length).toBe(1);
    });

    it("closeTabs с несохранённой последней вкладкой ждёт ответа: Cancel — false, вкладка на месте", async () => {
        service.openFile(ws.path("a.ts"));
        const editor = service.getActiveEditor()!;
        editor.viewState.type("dirty");
        const group = service.editorGroups.activeGroup;

        const closed = adapter.closeTabs({ tabs: [{ groupId: group.id, uri: editor.uri.toString() }] });
        // Решение за пользователем: тот же диалог, что у Ctrl+W.
        expect(dialogs.getOpenConfirmSaveDialog()).not.toBeNull();
        dialogs.getOpenConfirmSaveDialog()?.onCancel?.();

        await expect(closed).resolves.toBe(false);
        expect(group.editorCount).toBe(1);
    });

    it("closeTabs: Don't Save по грязной — true, закрыты все цели списка", async () => {
        service.openFile(ws.path("a.ts"));
        const dirty = service.getActiveEditor()!;
        dirty.viewState.type("dirty");
        service.openFile(ws.path("b.ts"));
        const clean = service.getActiveEditor()!;
        const group = service.editorGroups.activeGroup;

        const closed = adapter.closeTabs({
            tabs: [
                { groupId: group.id, uri: dirty.uri.toString() },
                { groupId: group.id, uri: clean.uri.toString() },
            ],
        });
        dialogs.getOpenConfirmSaveDialog()?.onDontSave?.();

        await expect(closed).resolves.toBe(true);
        expect(group.editorCount).toBe(0);
    });

    it("closeTabs: uri, которого нет в группе, пропускается — идемпотентный успех", async () => {
        service.openFile(ws.path("a.ts"));
        const group = service.editorGroups.activeGroup;

        await expect(
            adapter.closeTabs({ tabs: [{ groupId: group.id, uri: Uri.file(ws.path("b.ts")).toString() }] }),
        ).resolves.toBe(true);
        expect(group.editorCount).toBe(1);
    });

    describe("ViewColumn и фокус по полосе", () => {
        /** Две группы: первая с a.ts, вторая (активная) с b.ts; фокусы содержимого групп — в журнал. */
        function twoGroups() {
            service.openFile(ws.path("a.ts"));
            service.editorGroups.newGroup("after", { focus: false });
            service.openFile(ws.path("b.ts"));
            const [first, second] = service.editorGroups.groups;
            const focused: number[] = [];
            service.editorGroups.focusGroupContentHook = (group) =>
                focused.push(service.editorGroups.viewColumnOf(group));
            return { first, second, focused };
        }

        const uriOf = (name: string) => Uri.file(ws.path(name)).toString();

        it("Active — активная группа, даже если она не первая", async () => {
            const { second } = twoGroups();

            const result = await adapter.showTextDocument({ uri: uriOf("a.ts"), viewColumn: -1 });

            expect(result.viewColumn).toBe(2);
            expect(second.editorCount).toBe(2);
        });

        it("существующая неактивная колонка — открытие в ней, без фокуса содержимого групп", async () => {
            const { first, focused } = twoGroups();

            const result = await adapter.showTextDocument({ uri: uriOf("b.ts"), viewColumn: 1 });

            expect(result.viewColumn).toBe(1);
            expect(first.getPanes().map((pane) => path.basename(pane.uri.path))).toEqual(["a.ts", "b.ts"]);
            expect(service.editorGroups.activeGroup).toBe(first);
            expect(focused).toEqual([]);
        });

        it("preserveFocus — активной остаётся прежняя группа, содержимое групп фокус не получает", async () => {
            const { first, second, focused } = twoGroups();

            await adapter.showTextDocument({ uri: uriOf("b.ts"), viewColumn: 1, preserveFocus: true });

            expect(first.editorCount).toBe(2);
            expect(service.editorGroups.activeGroup).toBe(second);
            expect(focused).toEqual([]);
        });

        it("Beside с preserveFocus — новая группа справа, фокус содержимого не трогаем", async () => {
            const { second, focused } = twoGroups();

            const result = await adapter.showTextDocument({ uri: uriOf("a.ts"), viewColumn: -2, preserveFocus: true });

            expect(result.viewColumn).toBe(3);
            expect(service.editorGroups.activeGroup).toBe(second);
            expect(focused).toEqual([]);
        });

        it("колонка за краем — хвостовые группы дозаводятся в конце полосы, не рядом с активной", async () => {
            const { first, second, focused } = twoGroups();
            service.editorGroups.focusGroup({ index: 0 }, { focus: false });

            const result = await adapter.showTextDocument({ uri: uriOf("a.ts"), viewColumn: 4 });

            expect(result.viewColumn).toBe(4);
            expect(service.editorGroups.groups).toHaveLength(4);
            expect(service.editorGroups.groups.slice(0, 2)).toEqual([first, second]);
            expect(focused).toEqual([]);
        });

        it("снимок: активна ровно одна группа", () => {
            twoGroups();

            const layout = adapter.getLayoutSnapshot();

            expect(layout.groups.map((group) => group.isActive)).toEqual([false, true]);
        });

        it("closeTabs адресует вкладку по группе: тот же файл в другой группе остаётся", async () => {
            service.openFile(ws.path("a.ts"));
            service.splitActiveGroup();
            const [first, second] = service.editorGroups.groups;

            await adapter.closeTabs({ tabs: [{ groupId: second.id, uri: uriOf("a.ts") }] });

            expect(first.editorCount).toBe(1);
            expect(service.editorGroups.groups).toEqual([first]);
        });
    });

    it("closeGroups: неизвестная группа пропускается — идемпотентный успех", async () => {
        service.openFile(ws.path("a.ts"));

        await expect(adapter.closeGroups({ groupIds: [999] })).resolves.toBe(true);
        expect(service.editorGroups.groups.length).toBe(1);
    });

    it("closeGroups: вето в одной группе не мешает закрыть другую, ответ — false", async () => {
        service.openFile(ws.path("a.ts"));
        service.getActiveEditor()!.viewState.type("dirty");
        const first = service.editorGroups.activeGroup;
        service.editorGroups.newGroup("after");
        service.openFile(ws.path("b.ts"));
        const second = service.editorGroups.activeGroup;
        expect(service.editorGroups.groups.length).toBe(2);

        const closed = adapter.closeGroups({ groupIds: [first.id, second.id] });
        dialogs.getOpenConfirmSaveDialog()?.onCancel?.();

        await expect(closed).resolves.toBe(false);
        expect(first.editorCount).toBe(1);
        expect(service.editorGroups.groups).toEqual([first]);
    });

    it("снимок: дифф-вкладка несёт kind=diff и uri сторон (если они есть)", () => {
        service.openFile(ws.path("a.ts"));
        const diffInput: IDiffEditorPane2Input = {
            uri: Uri.parse("diode-diff:/a.ts?vs=HEAD"),
            label: "a.ts (diff)",
            originalLabel: "HEAD",
            modifiedLabel: "a.ts",
            original: { kind: "snapshot", text: "alpha" },
            modified: { kind: "snapshot", text: "alpha!" },
            languageId: "plaintext",
            originalUri: Uri.parse("git:/a.ts"),
            modifiedUri: Uri.file(ws.path("a.ts")),
        };
        const makePane = (input: IDiffEditorPane2Input) =>
            new DiffEditorPane2(
                NULL_LANGUAGE_SERVICE,
                new UndoRedoService(),
                diskFileService(),
                new TokenizationRegistry(),
                NULL_TOKEN_STYLE_RESOLVER,
                input,
            );
        service.openPane(makePane(diffInput));
        // Стороны опциональны (HEAD-версии может не существовать как ресурса).
        service.openPane(
            makePane({
                ...diffInput,
                uri: Uri.parse("diode-diff:/bare.ts"),
                originalUri: undefined,
                modifiedUri: undefined,
            }),
        );

        const tabs = adapter.getLayoutSnapshot().groups[0].tabs;
        expect(tabs.map((tab) => tab.kind)).toEqual(["text", "diff", "diff"]);
        expect(tabs[1].original).toBe("git:/a.ts");
        expect(tabs[1].modified).toBe(Uri.file(ws.path("a.ts")).toString());
        expect(tabs[2].original).toBeUndefined();
        expect(tabs[2].modified).toBeUndefined();
    });

    it("showTextDocument: Beside при нехватке места — фолбэк в активную группу", async () => {
        service.openFile(ws.path("a.ts"));
        service.editorGroups.canAddGroupHook = () => false;

        const result = await adapter.showTextDocument({
            uri: Uri.file(ws.path("b.ts")).toString(),
            viewColumn: -2,
        });
        expect(result.viewColumn).toBe(1);
        expect(service.editorGroups.groups.length).toBe(1);
        expect(service.editorGroups.activeGroup.editorCount).toBe(2);
    });

    it("showTextDocument: ViewColumn за краем при нехватке места — открытие в последней группе", async () => {
        service.openFile(ws.path("a.ts"));
        service.splitActiveGroup();
        service.editorGroups.canAddGroupHook = () => false;

        const result = await adapter.showTextDocument({
            uri: Uri.file(ws.path("b.ts")).toString(),
            viewColumn: 5,
        });
        expect(result.viewColumn).toBe(2);
        expect(service.editorGroups.groups.length).toBe(2);
    });
});
