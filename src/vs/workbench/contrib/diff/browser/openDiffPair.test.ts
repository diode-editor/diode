import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { createTestContainer } from "../../../../vexx/modules/testProfile.ts";
import { LanguageServiceDIToken } from "../../../common/coreTokens.ts";
import { DiffEditorPane } from "../../../browser/parts/editor/diffEditorPane.ts";
import type { WorkbenchComponent } from "../../../browser/workbenchComponent.ts";
import { WorkbenchComponentDIToken } from "../../../browser/workbenchComponent.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

import { openDiffPair } from "./openDiffPair.ts";

/**
 * Ядро пары источников: идентичность вкладки, дедуп с обновлением на месте,
 * политика нечитаемой стороны, «The files are identical». Команды семейства
 * сравнения — тонкие обёртки над этим, их тесты живут рядом с командами.
 */

describe("openDiffPair", () => {
    let ws: ITempWorkspace;
    let workbench: WorkbenchComponent;
    let editors: EditorService;
    let app: TestApp;
    let container: ReturnType<typeof createTestContainer>["container"];

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "vexx-diff-pair-",
            files: { "a.txt": "alpha\nbravo\n", "b.txt": "alpha\nBRAVO\n", "same.txt": "alpha\nbravo\n" },
        });
        const testContainer = createTestContainer();
        container = testContainer.container;
        workbench = container.get(WorkbenchComponentDIToken);
        editors = container.get(EditorServiceDIToken);
        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        app = TestApp.create(workbench.view, new Size(100, 16));
        testContainer.bindApp(app.app);
    });

    afterEach(() => {
        workbench.dispose();
        ws.dispose();
    });

    function fileSide(name: string) {
        const uri = Uri.file(ws.path(name));
        return { uri, label: name, identity: uri.toString() };
    }

    it("открывает вкладку пары файлов с метками сторон", async () => {
        const result = await openDiffPair(container, { original: fileSide("a.txt"), modified: fileSide("b.txt") });
        await settle(10);
        app.render();

        expect(result).toBe("opened");
        const screen = app.backend.screenToString();
        expect(screen).toContain("a.txt ↔ b.txt");
        expect(screen).toContain("-  bravo");
        expect(screen).toContain("+  BRAVO");
    });

    it("та же пара — одна вкладка, повторный вызов обновляет снимок на месте (US-32)", async () => {
        await openDiffPair(container, { original: fileSide("a.txt"), modified: fileSide("b.txt") });
        await settle(10);
        await openDiffPair(container, { original: fileSide("a.txt"), modified: fileSide("b.txt") });
        await settle(10);

        expect(editors.getPanes().filter((p) => p instanceof DiffEditorPane)).toHaveLength(1);
    });

    it("другая пара того же файла — отдельная вкладка (US-33)", async () => {
        await openDiffPair(container, { original: fileSide("a.txt"), modified: fileSide("b.txt") });
        await settle(10);
        await openDiffPair(container, { original: fileSide("same.txt"), modified: fileSide("b.txt") });
        await settle(10);

        expect(editors.getPanes().filter((p) => p instanceof DiffEditorPane)).toHaveLength(2);
    });

    it("перевёрнутая пара — другая вкладка: (лево, право) ≠ (право, лево)", async () => {
        await openDiffPair(container, { original: fileSide("a.txt"), modified: fileSide("b.txt") });
        await settle(10);
        await openDiffPair(container, { original: fileSide("b.txt"), modified: fileSide("a.txt") });
        await settle(10);

        expect(editors.getPanes().filter((p) => p instanceof DiffEditorPane)).toHaveLength(2);
    });

    it("текстовая сторона без uri (Clipboard) сравнивается с файлом", async () => {
        const result = await openDiffPair(container, {
            original: { text: "alpha\nCLIP\n", label: "Clipboard", identity: "clipboard:" },
            modified: fileSide("a.txt"),
        });
        await settle(10);
        app.render();

        expect(result).toBe("opened");
        const screen = app.backend.screenToString();
        expect(screen).toContain("Clipboard ↔ a.txt");
        expect(screen).toContain("-  CLIP");
        expect(screen).toContain("+  bravo");
    });

    it("идентичные стороны дают вкладку с сообщением, а не пустой дифф (US-11)", async () => {
        const result = await openDiffPair(container, { original: fileSide("a.txt"), modified: fileSide("same.txt") });
        await settle(10);
        app.render();

        expect(result).toBe("opened");
        expect(app.backend.screenToString()).toContain("The files are identical");
        // Вкладка нормально закрывается и не ломает навигацию.
        const pane = editors.getPanes().find((p) => p instanceof DiffEditorPane);
        expect(pane).toBeDefined();
        editors.closeTab(editors.getPanes().indexOf(pane ?? editors.getPanes()[0]));
        expect(editors.getPanes().filter((p) => p instanceof DiffEditorPane)).toHaveLength(0);
    });

    it("нечитаемая сторона с политикой error — отказ без вкладки", async () => {
        const result = await openDiffPair(container, {
            original: { uri: Uri.file(ws.path("gone.txt")), label: "gone.txt", identity: "gone" },
            modified: fileSide("a.txt"),
        });
        await settle(10);

        expect(result).toBe("unreadable");
        expect(editors.getPanes().filter((p) => p instanceof DiffEditorPane)).toHaveLength(0);
    });

    it("нечитаемая сторона с политикой empty — дифф против пустого (US-10)", async () => {
        const result = await openDiffPair(container, {
            original: { uri: Uri.file(ws.path("gone.txt")), label: "gone.txt", identity: "gone", onMissing: "empty" },
            modified: fileSide("a.txt"),
        });
        await settle(10);
        app.render();

        expect(result).toBe("opened");
        expect(app.backend.screenToString()).toMatch(/\+ {2}alpha/u);
    });

    it("пара без единого uri (текст ↔ текст) живёт на синтетическом пути", async () => {
        const result = await openDiffPair(container, {
            original: { text: "one\n", label: "L", identity: "l" },
            modified: { label: "R", identity: "r" },
        });
        await settle(10);
        app.render();

        // Правая сторона без текста и uri — легитимно пустая; вкладка `L ↔ R`.
        expect(result).toBe("opened");
        expect(app.backend.screenToString()).toContain("L ↔ R");
        expect(app.backend.screenToString()).toContain("-  one");
    });

    it("файл слева и текст справа: путь вкладки берётся у левой стороны", async () => {
        const result = await openDiffPair(container, {
            original: fileSide("a.txt"),
            modified: { text: "alpha\n", label: "snippet", identity: "snippet" },
        });
        await settle(10);

        expect(result).toBe("opened");
        const pane = editors.getPanes().find((p) => p instanceof DiffEditorPane);
        expect(pane?.uri.path.endsWith("a.txt")).toBe(true);
    });

    it("сторона со схемой без провайдера — отказ", async () => {
        const result = await openDiffPair(container, {
            original: { uri: Uri.from({ scheme: "weird", path: "/x" }), label: "x", identity: "weird:/x" },
            modified: fileSide("a.txt"),
        });

        expect(result).toBe("unreadable");
    });

    it("язык подсветки берётся по расширению файла, когда буфер не открыт", async () => {
        // Свой контейнер: языковой сервис подменяется ДО первого get (кеш DI).
        const { writeFileSync } = await import("node:fs");
        writeFileSync(ws.path("c.ts"), "const x = 1;\n");
        writeFileSync(ws.path("d.ts"), "const x = 2;\n");
        const local = createTestContainer();
        const asked: string[] = [];
        local.container.bind(LanguageServiceDIToken, () => ({
            getLanguageIdForResource: (filePath: string) => {
                asked.push(filePath);
                return filePath.endsWith(".ts") ? "typescript" : undefined;
            },
            getLanguageDisplayName: () => undefined,
            getExtensionForLanguage: () => undefined,
        }));
        const bench = local.container.get(WorkbenchComponentDIToken);
        bench.setWorkspaceFolder(ws.dir);
        bench.mount();
        const localApp = TestApp.create(bench.view, new Size(100, 16));
        local.bindApp(localApp.app);

        const result = await openDiffPair(local.container, {
            original: fileSide("c.ts"),
            modified: fileSide("d.ts"),
        });
        await settle(10);

        expect(result).toBe("opened");
        expect(asked.some((p) => p.endsWith("d.ts"))).toBe(true);
        bench.dispose();
    });

    it("несохранённые правки открытого буфера видны в диффе", async () => {
        container.get(CommandRegistryDIToken).execute("workbench.openFile", ws.path("a.txt"));
        await settle(0);
        const editor = editors.getActiveEditor();
        editor?.goToPosition(1, 0);
        editor?.viewState.type("XX");

        await openDiffPair(container, { original: fileSide("b.txt"), modified: fileSide("a.txt") });
        await settle(10);
        app.render();

        expect(app.backend.screenToString()).toContain("XXbravo");
    });
});
