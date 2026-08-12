import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { FileSystemProviderRegistry } from "../../../../platform/files/common/fileSystemProviderRegistry.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { createTestContainer } from "../../../../vexx/modules/testProfile.ts";
import { FileSystemProviderRegistryDIToken } from "../../../common/coreTokens.ts";
import { ORIGINAL_RESOURCE_COMMAND } from "../../../contrib/scm/browser/commandOriginalResourceProvider.ts";
import { DialogServiceDIToken } from "../../../services/dialogs/browser/dialogService.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { TextFileModel } from "../../../services/textfile/common/textFileModel.ts";
import type { WorkbenchComponent } from "../../workbenchComponent.ts";
import { WorkbenchComponentDIToken } from "../../workbenchComponent.ts";

import type { DiffV2SideSource } from "./diffEditorPane2.ts";
import { DiffEditorPane2 } from "./diffEditorPane2.ts";
import type { TextEditorPane } from "./textEditorPane.ts";

/**
 * Дифф v2 «до кадра»: команда → вкладка из двух настоящих редакторов —
 * выравнивание зонами, маркеры, парная свёртка, синхронный скролл, активная
 * сторона в getActiveEditor(), живой пересчёт по правкам сторон.
 */

const AT_HEAD = [
    ...Array.from({ length: 14 }, (_, i) => `const value${String(i)} = ${String(i)};`),
    "old line",
    "tail",
].join("\n");

describe("DiffEditorPane2 — юнит без workbench", () => {
    function makePane(
        original: DiffV2SideSource | string,
        modified: DiffV2SideSource | string,
        options: { debounceMs?: number } = {},
    ): DiffEditorPane2 {
        return new DiffEditorPane2(
            NULL_LANGUAGE_SERVICE,
            new UndoRedoService(),
            new TokenizationRegistry(),
            NULL_TOKEN_STYLE_RESOLVER,
            {
                uri: Uri.from({ scheme: "vexx-diff", path: "/pair", query: "left=a&right=b" }),
                label: "a ↔ b",
                originalLabel: "a",
                modifiedLabel: "b",
                original: typeof original === "string" ? { kind: "snapshot", text: original } : original,
                modified: typeof modified === "string" ? { kind: "snapshot", text: modified } : modified,
                languageId: "plaintext",
                ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
            },
        );
    }

    function ownedModel(text: string): TextFileModel {
        const model = new TextFileModel(NULL_LANGUAGE_SERVICE, new UndoRedoService());
        model.setUntitled(1);
        // До создания панели у модели нет вью — сеем контент владельческим путём.
        if (text !== "") model.replaceOwnedContent(text);
        return model;
    }

    function sides(pane: DiffEditorPane2): { original: TextEditorPane; modified: TextEditorPane } {
        const [original, modified] = pane.sidePanes();
        return { original, modified };
    }

    it("вход без uri сторон (текстовые стороны) — originalUri/modifiedUri null, снимок под замком", () => {
        const pane = makePane("one\n", "two\n");

        expect(pane.originalUri).toBeNull();
        expect(pane.modifiedUri).toBeNull();
        expect(pane.readOnly).toBe(true);
        expect(pane.isModified).toBe(false);
        expect(pane.snapshotSides()).toEqual(["original", "modified"]);
        pane.dispose();
    });

    it("два свёрнутых куска: плашки не путаются между регионами", () => {
        const base = Array.from({ length: 30 }, (_, i) => `l${String(i)}`);
        const original = [...base.slice(0, 10), "x", ...base.slice(10, 20), "y", ...base.slice(20)].join("\n");
        const modified = [...base.slice(0, 10), "X", ...base.slice(10, 20), "Y", ...base.slice(20)].join("\n");
        const pane = makePane(original, modified);

        const folded = pane.activeTextPane.viewState.foldedRegions.filter((r) => r.isCollapsed);
        expect(folded.length).toBeGreaterThanOrEqual(2);
        // Разворот первого куска оставляет второй свёрнутым с его плашкой.
        pane.activeTextPane.viewState.toggleFold(folded[0].startLine);
        const still = pane.activeTextPane.viewState.foldedRegions.filter((r) => r.isCollapsed);
        expect(still.length).toBe(folded.length - 1);
        pane.dispose();
    });

    it("owned-сторона редактируется, дифф пересчитывается по debounce, выравнивание держится", async () => {
        const base = Array.from({ length: 20 }, (_, i) => `line${String(i)}`).join("\n");
        const model = ownedModel(base);
        const pane = makePane(base, { kind: "owned", model }, { debounceMs: 0 });
        const { original, modified } = sides(pane);
        expect(pane.readOnly).toBe(false);
        expect(modified.readOnly).toBe(false);

        // Правка прямо в стороне (как набор с клавиатуры).
        modified.goToPosition(0, 5);
        modified.viewState.type("X");
        expect(pane.isModified).toBe(true);
        await settle(5);

        // Первая строка стала изменённой парой; выравнивание сторон держится.
        expect(original.viewState.getViewLineCount()).toBe(modified.viewState.getViewLineCount());
        expect(modified.viewState.foldedRegions.some((r) => r.isCollapsed)).toBe(true);
        pane.dispose();
    });

    it("живой пересчёт не сбрасывает каретку и держит развёрнутость куска", async () => {
        const base = Array.from({ length: 40 }, (_, i) => `line${String(i)}`).join("\n");
        const model = ownedModel(`${base}\nnew tail`);
        const pane = makePane(base, { kind: "owned", model }, { debounceMs: 0 });
        const { modified } = sides(pane);

        // Разворачиваем единственный кусок и правим в конце файла.
        const region = modified.viewState.foldedRegions.find((r) => r.isCollapsed);
        expect(region).toBeDefined();
        modified.viewState.toggleFold(region?.startLine ?? 0);
        modified.goToPosition(40, 0);
        modified.viewState.type("Z");
        await settle(5);

        // Кусок остался развёрнутым (перенос по пересечению), каретка на месте.
        expect(modified.viewState.foldedRegions.some((r) => r.isCollapsed)).toBe(false);
        expect(modified.primaryCursorLine).toBe(40);
        pane.dispose();
    });

    it("кусок, накрывший каретку, разворачивается — печатающий не оказывается на скрытой строке", async () => {
        const base = Array.from({ length: 30 }, (_, i) => `line${String(i)}`).join("\n");
        const model = ownedModel(`${base}\nextra`);
        const pane = makePane(base, { kind: "owned", model }, { debounceMs: 0 });
        const { modified } = sides(pane);
        const region = modified.viewState.foldedRegions.find((r) => r.isCollapsed);
        expect(region).toBeDefined();

        // Каретка программно в скрытой части куска; правка триггерит пересчёт.
        modified.viewState.selections = [{ anchor: { line: 10, character: 0 }, active: { line: 10, character: 0 } }];
        modified.viewState.type("Q");
        await settle(5);

        // Кусок с кареткой развёрнут: строка каретки видима.
        expect(modified.viewState.logicalToVisualLine(modified.primaryCursorLine)).toBeGreaterThanOrEqual(0);
        pane.dispose();
    });

    it("скролл якорится по документной строке при пересчёте", async () => {
        const base = Array.from({ length: 60 }, (_, i) => `line${String(i)}`).join("\n");
        const model = ownedModel(base.replace("line30", "changed30"));
        const pane = makePane(base, { kind: "owned", model }, { debounceMs: 0 });
        const { modified, original } = sides(pane);

        // Разворачиваем всё и ставим вьюпорт на середину.
        for (const region of modified.viewState.foldedRegions) {
            if (region.isCollapsed) modified.viewState.toggleFold(region.startLine);
        }
        await settle(5);
        // Правка в конце: reveal каретки ставит вьюпорт куда-то вниз; сам
        // ПЕРЕСЧЁТ (по debounce) не должен сдвигать его дальше, а у original
        // при этом появляется зона-филлер — его проекция меняется, но окно
        // остаётся зеркальным.
        modified.goToPosition(59, 0);
        modified.viewState.type("Z");
        const anchorDoc = modified.viewState.docLineForViewLine(modified.viewState.scrollTop);
        await settle(5);

        expect(modified.viewState.docLineForViewLine(modified.viewState.scrollTop)).toBe(anchorDoc);
        expect(original.viewState.scrollTop).toBe(modified.viewState.scrollTop);
        pane.dispose();
    });

    it("кусок, накрывший каретку ДРУГОЙ стороны, разворачивается при пересчёте", async () => {
        // Обе стороны — модели; правка в original не трогает каретку modified,
        // припаркованную в скрытой части unchanged-куска.
        const base = Array.from({ length: 40 }, (_, i) => `line${String(i)}`).join("\n");
        const original = ownedModel(base);
        const modified = ownedModel(base);
        const pane = makePane({ kind: "owned", model: original }, { kind: "owned", model: modified }, { debounceMs: 0 });
        const sidePanes = pane.sidePanes();
        expect(sidePanes[1].viewState.foldedRegions.some((r) => r.isCollapsed)).toBe(true);

        sidePanes[1].viewState.selections = [
            { anchor: { line: 20, character: 0 }, active: { line: 20, character: 0 } },
        ];
        sidePanes[0].viewState.type("X"); // правка original на строке 0
        await settle(5);

        // Кусок вокруг каретки развёрнут — печатающий видит свою строку.
        expect(sidePanes[1].viewState.logicalToVisualLine(20)).toBeGreaterThanOrEqual(0);
        pane.dispose();
    });

    it("слившиеся куски наследуют свёрнутость по большему пересечению", async () => {
        // Два изменения делят файл на два unchanged-куска; первый разворачиваем,
        // затем правкой убираем первое изменение — куски сливаются в один.
        const base = Array.from({ length: 40 }, (_, i) => `line${String(i)}`);
        const originalText = base.join("\n");
        const modifiedLines = [...base];
        modifiedLines[10] = "CHANGED10";
        modifiedLines[30] = "CHANGED30";
        const model = ownedModel(modifiedLines.join("\n"));
        const pane = makePane(originalText, { kind: "owned", model }, { debounceMs: 0 });
        const { modified } = sides(pane);

        const collapsed = modified.viewState.foldedRegions.filter((r) => r.isCollapsed);
        expect(collapsed.length).toBeGreaterThanOrEqual(2);
        modified.viewState.toggleFold(collapsed[0].startLine);
        await settle(5);

        // Возвращаем строке 10 исходное содержимое — первое изменение исчезает.
        modified.applyExternalEdits(
            [{ range: { start: { line: 10, character: 0 }, end: { line: 10, character: 9 } }, text: "line10" }],
            "revert",
        );
        await settle(5);

        // Кусков стало меньше, и панель не разъехалась (выравнивание держится).
        expect(pane.sidePanes()[0].viewState.getViewLineCount()).toBe(modified.viewState.getViewLineCount());
        pane.dispose();
    });

    it("регион без прежних пар сворачивается, скрывая якорь скролла без прыжка", async () => {
        // Стороны полностью разные: регионов нет. Замена original снимка на
        // текст modified делает файлы идентичными — появляется первый регион
        // (без прежних пар — свёрнут), и прежний якорь вьюпорта скрыт.
        const originalText = Array.from({ length: 40 }, (_, i) => `A${String(i)}`).join("\n");
        const modifiedText = Array.from({ length: 40 }, (_, i) => `B${String(i)}`).join("\n");
        const pane = makePane(originalText, modifiedText, { debounceMs: 0 });
        const { modified } = sides(pane);
        expect(modified.viewState.foldedRegions).toHaveLength(0);
        modified.viewState.scrollTop = 20;

        pane.replaceSnapshotContent("original", modifiedText);
        await settle(5);

        // Единственный регион свёрнут (прежних пар не было), паника не случилась.
        expect(modified.viewState.foldedRegions.some((r) => r.isCollapsed)).toBe(true);
        pane.dispose();
    });

    it("replaceSnapshotContent: тот же текст — no-op, новый — пересчёт и живой синк", async () => {
        const pane = makePane("a\nb\nc", "a\nB\nc", { debounceMs: 0 });
        const { original, modified } = sides(pane);
        const viewStateBefore = original.viewState;

        pane.replaceSnapshotContent("original", "a\nb\nc");
        expect(original.viewState).toBe(viewStateBefore);

        pane.replaceSnapshotContent("original", "a\nb2\nc");
        await settle(5);
        // View-state пересоздан перечиткой, но синк перевешан: скролл зеркалится.
        expect(original.viewState).not.toBe(viewStateBefore);
        expect(original.viewState.getViewLineCount()).toBe(modified.viewState.getViewLineCount());
        modified.viewState.scrollTop = 1;
        expect(original.viewState.scrollTop).toBe(1);

        // Не-снимочную сторону заменить нельзя.
        const ownPane = makePane("x", { kind: "owned", model: ownedModel("x") });
        ownPane.replaceSnapshotContent("modified", "y");
        expect(ownPane.sidePanes()[1].getText()).toBe("x");
        ownPane.dispose();
        pane.dispose();
    });

    it("onDidChangeState сводит события сторон; исчерпанная подписка снимается", async () => {
        const model = ownedModel("x");
        const pane = makePane("x", { kind: "owned", model }, { debounceMs: 0 });
        let fired = 0;
        const subscription = pane.onDidChangeState(() => {
            fired++;
        });

        pane.sidePanes()[1].viewState.type("y");
        expect(fired).toBeGreaterThan(0);

        const before = fired;
        subscription.dispose();
        pane.sidePanes()[1].viewState.type("z");
        expect(fired).toBe(before);
        await settle(5);
        pane.dispose();
    });
});

describe("Workbench — дифф v2", () => {
    let ws: ITempWorkspace;
    let workbench: WorkbenchComponent;
    let editors: EditorService;
    let app: TestApp;
    let container: ReturnType<typeof createTestContainer>["container"];

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "vexx-diffv2-", files: { "a.txt": AT_HEAD } });
        const testContainer = createTestContainer();
        container = testContainer.container;
        const registry = new FileSystemProviderRegistry();
        registry.registerProvider("git", {
            readFile: () => Promise.resolve(new TextEncoder().encode(AT_HEAD)),
            onDidChangeFile: () => ({ dispose: () => undefined }),
        });
        container.bind(FileSystemProviderRegistryDIToken, () => registry);
        workbench = container.get(WorkbenchComponentDIToken);
        editors = container.get(EditorServiceDIToken);
        container
            .get(CommandRegistryDIToken)
            .register(ORIGINAL_RESOURCE_COMMAND, (raw) =>
                Uri.from({ scheme: "git", path: String(raw), query: '{"ref":"HEAD"}' }).toString(),
            );
        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        app = TestApp.create(workbench.view, new Size(140, 24));
        testContainer.bindApp(app.app);
        container.get(CommandRegistryDIToken).execute("workbench.openFile", ws.path("a.txt"));
        await settle(0);
    });

    afterEach(() => {
        workbench.dispose();
        ws.dispose();
    });

    async function openV2(): Promise<DiffEditorPane2> {
        const editor = editors.getActiveEditor();
        editor?.goToPosition(14, 0);
        editor?.viewState.type("XX");
        container.get(CommandRegistryDIToken).execute("vexx.scm.compareWithHead");
        await settle(20);
        app.render();
        const pane = editors.getActiveTabPane();
        expect(pane instanceof DiffEditorPane2).toBe(true);
        return pane as DiffEditorPane2;
    }

    it("вкладка — два настоящих редактора: пары на одной высоте, маркеры, плашки", async () => {
        await openV2();

        const lines = app.backend
            .screenToString()
            .split("\n")
            .map((l) => l.replace(/\s+$/, ""));
        // Изменённая пара на одной строке: слева -old, справа +XX.
        const pair = lines.find((l) => l.includes("old line") && l.includes("XXold line"));
        expect(pair).toBeDefined();
        expect(pair).toMatch(/15-.*│.*15\+/u);
        // Парная плашка свёртки с обеих сторон разделителя.
        const plaque = lines.find((l) => l.includes("unchanged lines"));
        expect(plaque).toBeDefined();
        expect(plaque?.split("│").filter((part) => part.includes("unchanged lines"))).toHaveLength(2);
    });

    it("modified-сторона — живой буфер файла: правка в диффе видна во вкладке файла", async () => {
        const fileEditor = editors.getActiveEditor();
        const pane = await openV2();

        // Модель общая: сторона и вкладка файла — один документ.
        expect(pane.activeTextPane.model === fileEditor?.model).toBe(true);
        expect(pane.readOnly).toBe(false);
        expect(pane.isModified).toBe(true); // несохранённые XX

        // Правка прямо в стороне диффа доезжает до вкладки файла.
        pane.activeTextPane.goToPosition(15, 0);
        pane.activeTextPane.viewState.type("Y");
        expect(fileEditor?.getText()).toContain("Ytail");
    });

    it("правка из вкладки файла оживляет дифф после debounce", async () => {
        const fileEditor = editors.getActiveEditor();
        const pane = await openV2();
        const [original, modified] = pane.sidePanes();

        // Правим ЧЕРЕЗ вкладку файла (модель общая, вкладка даже не активна).
        fileEditor?.applyExternalEdits(
            [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "W" }],
            "test",
        );
        await settle(250); // debounce 200

        // Первая строка стала изменённой парой (фон и маркер по ней), стороны выровнены.
        expect(original.viewState.getViewLineCount()).toBe(modified.viewState.getViewLineCount());
        app.render();
        const lines = app.backend.screenToString().split("\n");
        expect(lines.find((l) => l.includes("Wconst value0") && l.includes("const value0"))).toBeDefined();
    });

    it("getActiveEditor отдаёт активную сторону — команды курсора живут", async () => {
        const pane = await openV2();

        const sideEditor = editors.getActiveEditor();
        expect(sideEditor).not.toBeNull();
        expect(sideEditor === pane.activeTextPane).toBe(true);
        // Modified-сторона — живой буфер, редактируется; original — снимок HEAD.
        expect(sideEditor?.readOnly).toBe(false);
        expect(pane.sidePanes()[0].readOnly).toBe(true);

        // Каретка проскакивает скрытый свёрткой кусок и зону-плашку: cursorDown
        // с заголовка уводит на первую видимую документную строку за ними.
        const before = sideEditor?.viewState.selections[0].active.line ?? -1;
        container.get(CommandRegistryDIToken).execute("cursorDown");
        const after = sideEditor?.viewState.selections[0].active.line ?? -1;
        expect(after).toBeGreaterThan(before);
        expect(sideEditor?.viewState.logicalToVisualLine(after)).toBeGreaterThan(0);
    });

    it("скролл зеркалится между сторонами", async () => {
        const pane = await openV2();

        pane.viewState.scrollTop = 3;
        app.render();

        expect(pane.activeSide).toBe("modified");
        expect(pane.sidePanes()[0].viewState.scrollTop).toBe(3);
    });

    it("разворот свёрнутого куска разворачивает пару и убирает плашки", async () => {
        const pane = await openV2();
        const modified = pane.activeTextPane.viewState;
        const collapsedRegion = modified.foldedRegions.find((r) => r.isCollapsed);
        expect(collapsedRegion).toBeDefined();

        modified.toggleFold(collapsedRegion?.startLine ?? 0);
        await settle(10);
        app.render();

        // Обе стороны развернулись, плашек не осталось.
        const original = pane.sidePanes()[0];
        expect(original.viewState.foldedRegions.some((r) => r.isCollapsed)).toBe(false);
        expect(app.backend.screenToString()).not.toContain("unchanged lines");
        // Выравнивание держится.
        expect(original.viewState.getViewLineCount()).toBe(modified.getViewLineCount());
    });

    it("getSelectedText отдаёт текст активной стороны без служебных строк", async () => {
        const pane = await openV2();

        pane.viewState.selections = [{ anchor: { line: 14, character: 0 }, active: { line: 14, character: 6 } }];

        expect(pane.getSelectedText()).toBe("XXold ");
    });

    it("фокус в левой колонке переключает активную сторону", async () => {
        const pane = await openV2();
        expect(pane.activeSide).toBe("modified");

        pane.sidePanes()[0].component.focus();

        expect(pane.activeSide).toBe("original");
        expect(editors.getActiveEditor() === pane.activeTextPane).toBe(true);
    });

    it("команды без активного файла и без git — тихий no-op и нотис", async () => {
        // Без активного редактора (закрыть файл) — no-op.
        editors.closeTab(editors.activeIndex);
        container.get(CommandRegistryDIToken).execute("vexx.scm.compareWithHead");
        await settle(20);
        expect(editors.editorCount).toBe(0);

        // Файл есть, но провайдера оригинала нет — нотис.
        const bare = createTempWorkspace({ prefix: "vexx-diffv2-bare-", files: { "b.txt": "x\n" } });
        try {
            container.get(CommandRegistryDIToken).execute("workbench.openFile", bare.path("b.txt"));
            await settle(0);
            container.get(CommandRegistryDIToken).register(ORIGINAL_RESOURCE_COMMAND, () => null);
            container.get(CommandRegistryDIToken).execute("vexx.scm.compareWithHead");
            await settle(20);
            app.render();
            expect(app.backend.screenToString()).toContain("No changes to compare");
        } finally {
            bare.dispose();
        }
    });

    it("вкладка закрывается без диалога (модель жива во вкладке файла), повтор обновляет на месте", async () => {
        await openV2();
        const countAfterFirst = editors.editorCount;

        // Повторный вызов С АКТИВНОЙ дифф-вкладкой целится в её исходный файл.
        container.get(CommandRegistryDIToken).execute("vexx.scm.compareWithHead");
        await settle(20);
        expect(editors.editorCount).toBe(countAfterFirst);

        // Несохранённые правки живут в модели файла — дифф закрывается молча.
        editors.closeTab(editors.activeIndex);
        expect(editors.editorCount).toBe(countAfterFirst - 1);
    });

    it("диалог закрытия dirty-untitled-диффа: Save без пути оставляет вкладку, Don't Save закрывает", async () => {
        container.get(CommandRegistryDIToken).execute("workbench.files.action.compareNewUntitledTextFiles");
        await settle(30);
        const pane = editors.getActiveTabPane();
        expect(pane instanceof DiffEditorPane2).toBe(true);
        (pane as DiffEditorPane2).sidePanes()[1].viewState.type("keepme");

        const dialogs = container.get(DialogServiceDIToken);
        editors.onRequestConfirmClose?.(editors.activeGroup, editors.activeIndex);
        app.render();
        // Диалог называет dirty-сторону.
        expect(app.backend.screenToString()).toContain("Untitled-2");

        // Save: у untitled нет пути («no-file») — текст не должен молча пропасть,
        // вкладка остаётся открытой.
        dialogs.getOpenConfirmSaveDialog()?.onSave?.();
        await settle(10);
        expect(editors.getActiveTabPane()).toBe(pane);

        // Don't Save — закрывает.
        editors.onRequestConfirmClose?.(editors.activeGroup, editors.activeIndex);
        dialogs.getOpenConfirmSaveDialog()?.onDontSave?.();
        await settle(10);
        expect(editors.getPanes().includes(pane as DiffEditorPane2)).toBe(false);
    });

    it("диалог закрытия диффа с file-стороной: Save пишет файл и закрывает вкладку", async () => {
        await openV2();
        // Файловая вкладка закрыта — dirty-модель живёт только в стороне диффа.
        editors.closeTab(0);
        const pane = editors.getActiveTabPane() as DiffEditorPane2;
        expect(editors.needsCloseConfirm(pane)).toBe(true);

        const dialogs = container.get(DialogServiceDIToken);
        editors.onRequestConfirmClose?.(editors.activeGroup, editors.activeIndex);
        dialogs.getOpenConfirmSaveDialog()?.onSave?.();
        await settle(20);

        expect(editors.getPanes().includes(pane)).toBe(false);
        const { readFileSync } = await import("node:fs");
        expect(readFileSync(ws.path("a.txt"), "utf8")).toContain("XXold line");
    });

    it("closeEditorsInGroup спрашивает про dirty-дифф; Cancel оставляет, Don't Save закрывает", async () => {
        container.get(CommandRegistryDIToken).execute("workbench.files.action.compareNewUntitledTextFiles");
        await settle(30);
        const pane = editors.getActiveTabPane() as DiffEditorPane2;
        pane.sidePanes()[1].viewState.type("dirty");
        const dialogs = container.get(DialogServiceDIToken);

        container.get(CommandRegistryDIToken).execute("workbench.action.closeEditorsInGroup");
        await settle(10);
        dialogs.getOpenConfirmSaveDialog()?.onCancel?.();
        await settle(10);
        expect(editors.getPanes().includes(pane)).toBe(true);

        container.get(CommandRegistryDIToken).execute("workbench.action.closeEditorsInGroup");
        await settle(10);
        dialogs.getOpenConfirmSaveDialog()?.onDontSave?.();
        await settle(10);
        expect(editors.getPanes().includes(pane)).toBe(false);
    });

    it("закрытие вкладки файла при открытом диффе — без диалога: правки живут в стороне", async () => {
        await openV2();

        // Активируем вкладку файла (индекс 0) и закрываем её: модель dirty, но
        // дифф-сторона держит тот же документ — диалог не нужен.
        const closed = new Promise<void>((resolve) => {
            editors.onRequestConfirmClose = () => {
                throw new Error("не должно быть диалога");
            };
            resolve();
        });
        editors.activateTab(0);
        const fileEditor = editors.getActiveTabEditor();
        expect(fileEditor?.isModified).toBe(true);
        expect(editors.needsCloseConfirm(fileEditor!)).toBe(false);
        await closed;

        // А дифф после этого — последняя поверхность документа: ему диалог нужен.
        editors.activateTab(1);
        const diffPane = editors.getActiveTabPane() as DiffEditorPane2;
        editors.closeTab(0);
        expect(editors.needsCloseConfirm(diffPane)).toBe(true);
        expect(editors.dirtyExclusiveDiffSides(diffPane).map((s) => s.label)).toEqual(["a.txt"]);
    });
});
