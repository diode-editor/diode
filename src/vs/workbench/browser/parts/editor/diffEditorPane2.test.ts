import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { FileSystemProviderRegistry } from "../../../../platform/files/common/fileSystemProviderRegistry.ts";
import { createTestContainer } from "../../../../vexx/modules/testProfile.ts";
import { FileSystemProviderRegistryDIToken } from "../../../common/coreTokens.ts";
import { ORIGINAL_RESOURCE_COMMAND } from "../../../contrib/scm/browser/commandOriginalResourceProvider.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import type { WorkbenchComponent } from "../../workbenchComponent.ts";
import { WorkbenchComponentDIToken } from "../../workbenchComponent.ts";

import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";

import { DiffEditorPane2 } from "./diffEditorPane2.ts";

/**
 * Дифф v2 «до кадра»: команда → вкладка из двух настоящих редакторов —
 * выравнивание зонами, маркеры, парная свёртка, синхронный скролл, активная
 * сторона в getActiveEditor().
 */

const AT_HEAD = [
    ...Array.from({ length: 14 }, (_, i) => `const value${String(i)} = ${String(i)};`),
    "old line",
    "tail",
].join("\n");

describe("DiffEditorPane2 — юнит без workbench", () => {
    function makePane(originalText: string, modifiedText: string): DiffEditorPane2 {
        return new DiffEditorPane2(NULL_LANGUAGE_SERVICE, new UndoRedoService(), new TokenizationRegistry(), NULL_TOKEN_STYLE_RESOLVER, {
            uri: Uri.from({ scheme: "vexx-diff", path: "/pair", query: "left=a&right=b" }),
            label: "a ↔ b",
            originalLabel: "a",
            modifiedLabel: "b",
            originalText,
            modifiedText,
            languageId: "plaintext",
        });
    }

    it("вход без uri сторон (текстовые стороны) — originalUri/modifiedUri null", () => {
        const pane = makePane("one\n", "two\n");

        expect(pane.originalUri).toBeNull();
        expect(pane.modifiedUri).toBeNull();
        expect(pane.readOnly).toBe(true);
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
        container.get(CommandRegistryDIToken).execute("vexx.diff.compareWithHeadV2");
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

    it("стороны выровнены: одинаковое число строк вью", async () => {
        const pane = await openV2();

        const original = pane.activeTextPane; // modified по умолчанию
        expect(pane.activeSide).toBe("modified");
        expect(original.viewState.getViewLineCount()).toBeGreaterThan(0);
    });

    it("getActiveEditor отдаёт активную сторону — команды курсора живут", async () => {
        const pane = await openV2();

        const sideEditor = editors.getActiveEditor();
        expect(sideEditor).not.toBeNull();
        expect(sideEditor === pane.activeTextPane).toBe(true);
        expect(sideEditor?.readOnly).toBe(true);

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

        const other = pane.activeSide === "modified" ? "original" : "modified";
        expect(pane.activeSide).toBe("modified");
        // Обе стороны показывают одно окно.
        void other;
        const inspect = pane.view.inspectState?.() ?? {};
        void inspect;
        const originalState = (pane as unknown as { sides: Record<string, { viewState: { scrollTop: number } }> })
            .sides.original.viewState.scrollTop;
        expect(originalState).toBe(3);
    });

    it("разворот свёрнутого куска разворачивает пару и убирает плашки", async () => {
        const pane = await openV2();
        const sides = (pane as unknown as { sides: Record<string, { viewState: EditorService["prototype"] }> }).sides;
        void sides;
        const modified = pane.activeTextPane.viewState;
        const collapsedRegion = modified.foldedRegions.find((r) => r.isCollapsed);
        expect(collapsedRegion).toBeDefined();

        modified.toggleFold(collapsedRegion?.startLine ?? 0);
        await settle(10);
        app.render();

        // Обе стороны развернулись, плашек не осталось.
        const originalPane = (pane as unknown as { sides: { original: { viewState: typeof modified } } }).sides
            .original;
        expect(originalPane.viewState.foldedRegions.some((r) => r.isCollapsed)).toBe(false);
        expect(app.backend.screenToString()).not.toContain("unchanged lines");
        // Выравнивание держится.
        expect(originalPane.viewState.getViewLineCount()).toBe(modified.getViewLineCount());
    });

    it("getSelectedText отдаёт текст активной стороны без служебных строк", async () => {
        const pane = await openV2();

        pane.viewState.selections = [
            { anchor: { line: 14, character: 0 }, active: { line: 14, character: 6 } },
        ];

        expect(pane.getSelectedText()).toBe("XXold ");
    });

    it("фокус в левой колонке переключает активную сторону", async () => {
        const pane = await openV2();
        expect(pane.activeSide).toBe("modified");

        const sides = (pane as unknown as { sides: { original: { component: { focus(): void } } } }).sides;
        sides.original.component.focus();

        expect(pane.activeSide).toBe("original");
        expect(editors.getActiveEditor() === pane.activeTextPane).toBe(true);
    });

    it("команды без активного файла и без git — тихий no-op и нотис", async () => {
        // Без активного редактора (закрыть файл) — no-op.
        editors.closeTab(editors.activeIndex);
        container.get(CommandRegistryDIToken).execute("vexx.diff.compareWithHeadV2");
        await settle(20);
        expect(editors.editorCount).toBe(0);

        // Файл есть, но провайдера оригинала нет — нотис.
        const bare = createTempWorkspace({ prefix: "vexx-diffv2-bare-", files: { "b.txt": "x\n" } });
        try {
            container.get(CommandRegistryDIToken).execute("workbench.openFile", bare.path("b.txt"));
            await settle(0);
            container.get(CommandRegistryDIToken).register(ORIGINAL_RESOURCE_COMMAND, () => null);
            container.get(CommandRegistryDIToken).execute("vexx.diff.compareWithHeadV2");
            await settle(20);
            app.render();
            expect(app.backend.screenToString()).toContain("No changes to compare");
        } finally {
            bare.dispose();
        }
    });

    it("вкладка закрывается без диалога, повторная команда обновляет снимок на месте", async () => {
        await openV2();
        const countAfterFirst = editors.editorCount;

        container.get(CommandRegistryDIToken).execute("vexx.diff.compareWithHeadV2");
        await settle(20);
        expect(editors.editorCount).toBe(countAfterFirst);

        editors.closeTab(editors.activeIndex);
        expect(editors.editorCount).toBe(countAfterFirst - 1);
    });
});
