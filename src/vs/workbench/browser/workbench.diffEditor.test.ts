import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Size } from "../../../../tuidom/common/geometryPromitives.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { settle } from "../../../TestUtils/timing.ts";
import { Uri } from "../../base/common/uri.ts";
import { CommandRegistry, CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { FileSystemProviderRegistry } from "../../platform/files/common/fileSystemProviderRegistry.ts";
import { createTestContainer } from "../../vexx/modules/testProfile.ts";
import { ClipboardDIToken, FileSystemProviderRegistryDIToken } from "../common/coreTokens.ts";
import { ORIGINAL_RESOURCE_COMMAND } from "../contrib/scm/browser/commandOriginalResourceProvider.ts";
import { COMPARE_NOTICE_MS, openDiffWithHead } from "../contrib/scm/browser/compareWithHeadAction.ts";
import type { EditorService } from "../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/browser/editorService.ts";

import { WorkbenchComponent, WorkbenchComponentDIToken } from "./workbenchComponent.ts";

/**
 * Сквозной гейт этапа 5 «до кадра»: настоящая команда открывает настоящую
 * вкладку, и на экране видны строки диффа. Роль SCM играет заглушка — реестр
 * провайдеров отдаёт «версию из HEAD», как это делает git-расширение; весь путь
 * ядра от команды до пикселей при этом настоящий.
 */

const AT_HEAD = "alpha\nbravo\ncharlie\ndelta\n";
const COMPARE = "vexx.scm.compareWithHead";

describe("Workbench — вкладка diff", () => {
    let ws: ITempWorkspace;
    let workbench: WorkbenchComponent;
    let commands: CommandRegistry;
    let editors: EditorService;
    let testApp: TestApp;
    let container: ReturnType<typeof createTestContainer>["container"];

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "vexx-diff-", files: { "a.txt": AT_HEAD } });

        const testContainer = createTestContainer();
        const bindApp = testContainer.bindApp;
        container = testContainer.container;
        const registry = new FileSystemProviderRegistry();
        registry.registerProvider("git", {
            readFile: () => Promise.resolve(new TextEncoder().encode(AT_HEAD)),
            onDidChangeFile: () => ({ dispose: () => undefined }),
        });
        container.bind(FileSystemProviderRegistryDIToken, () => registry);

        workbench = container.get(WorkbenchComponentDIToken);
        commands = container.get(CommandRegistryDIToken);
        editors = container.get(EditorServiceDIToken);
        commands.register(ORIGINAL_RESOURCE_COMMAND, (raw) =>
            Uri.from({ scheme: "git", path: String(raw), query: '{"ref":"HEAD"}' }).toString(),
        );

        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        testApp = TestApp.create(workbench.view, new Size(100, 16));
        bindApp(testApp.app);

        commands.execute("workbench.openFile", ws.path("a.txt"));
        await settle(0);
    });

    afterEach(() => {
        workbench.dispose();
        ws.dispose();
    });

    /** Правит буфер, не сохраняя: дифф должен показать именно несохранённое. */
    function editBuffer(): void {
        const editor = editors.getActiveEditor();
        editor?.goToPosition(1, 0);
        editor?.viewState.type("XX");
    }

    it("команда открывает вкладку с диффом и показывает - и + строки", async () => {
        editBuffer();

        commands.execute(COMPARE);
        await settle(10);
        testApp.render();

        const screen = testApp.backend.screenToString();
        // Вкладка появилась под своей меткой.
        expect(screen).toContain("a.txt ↔ HEAD");
        // Обе стороны правки видны: старая строка и новая (гуттер v2: `N-`/`N+`).
        expect(screen).toMatch(/2-\s+bravo/u);
        expect(screen).toMatch(/2\+\s+XXbravo/u);
    });

    it("вкладка диффа закрывается без диалога сохранения", async () => {
        editBuffer();
        commands.execute(COMPARE);
        await settle(10);

        const pane = editors.getActivePane();
        // Modified-сторона — живой буфер файла с несохранёнными правками, так
        // что вкладка честно помечена изменённой; но диалог не нужен: документ
        // виден и во вкладке файла, правки живут в общей модели.
        expect(pane?.isModified).toBe(true);
        expect(pane === null ? true : editors.needsCloseConfirm(pane)).toBe(false);

        editors.closeTab(editors.activeIndex);
        testApp.render();

        expect(testApp.backend.screenToString()).not.toContain("↔ HEAD");
    });

    it("повторный вызов переключает на существующую вкладку, а не плодит новые", async () => {
        editBuffer();
        commands.execute(COMPARE);
        await settle(10);
        const countAfterFirst = editors.editorCount;

        editors.activateTab(0);
        commands.execute(COMPARE);
        await settle(10);

        expect(editors.editorCount).toBe(countAfterFirst);
    });

    it("повторный вызов после новой правки показывает свежий снимок, а не устаревший", async () => {
        editBuffer(); // первая правка: XX
        commands.execute(COMPARE);
        await settle(10);
        testApp.render();
        expect(testApp.backend.screenToString()).toMatch(/2\+\s+XXbravo/u);

        // Возврат в редактор и вторая правка.
        editors.activateTab(0);
        const editor = editors.getActiveEditor();
        editor?.goToPosition(1, 0);
        editor?.viewState.type("YY");

        commands.execute(COMPARE);
        await settle(10);
        testApp.render();

        const screen = testApp.backend.screenToString();
        // Стороны живые: дифф показывает обе правки, а не только первую.
        expect(screen).toMatch(/2\+\s+YYXXbravo/u);
        // И по-прежнему ровно одна дифф-вкладка — обновили на месте, не завели вторую.
        expect(editors.getPanes().filter((p) => p.uri.scheme === "vexx-diff")).toHaveLength(1);
    });

    it("возврат на файл возвращает обычный редактор", async () => {
        editBuffer();
        commands.execute(COMPARE);
        await settle(10);
        testApp.render();
        expect(testApp.backend.screenToString()).toContain("↔ HEAD");

        editors.activateTab(0);
        testApp.render();

        const screen = testApp.backend.screenToString();
        expect(screen).toContain("XXbravo");
        expect(screen).not.toMatch(/2-\s+bravo/u);
    });

    it("без версии в git вкладка не открывается, а в статус-баре появляется сообщение", async () => {
        // Убираем команду SCM — так выглядит untracked-файл или отсутствие расширения.
        const { container, bindApp } = createTestContainer();
        const bare = container.get(WorkbenchComponentDIToken);
        const bareCommands = container.get(CommandRegistryDIToken);
        const bareEditors = container.get(EditorServiceDIToken);
        bare.setWorkspaceFolder(ws.dir);
        bare.mount();
        const app = TestApp.create(bare.view, new Size(100, 16));
        bindApp(app.app);
        bareCommands.execute("workbench.openFile", ws.path("a.txt"));
        await settle(0);

        bareCommands.execute(COMPARE);
        await settle(10);
        app.render();

        expect(bareEditors.editorCount).toBe(1);
        expect(app.backend.screenToString()).toContain("No changes to compare");
        bare.dispose();
    });

    // ─── Дифф как текстовая поверхность ───────────────────────────────────────

    /** Открывает дифф с правкой в буфере и уводит в него фокус. */
    async function openDiff(): Promise<void> {
        editBuffer();
        commands.execute(COMPARE);
        await settle(10);
        editors.getActivePane()?.focusEditor();
        testApp.render();
    }

    it("активная панель отдаёт свою сторону как настоящий текстовый редактор", async () => {
        await openDiff();

        expect(editors.getActiveViewState()).not.toBeNull();
        // Modified-сторона — живой буфер файла: редактируется прямо в диффе.
        expect(editors.getActiveViewState()?.readOnly).toBe(false);
        const side = editors.getActiveEditor();
        expect(side).not.toBeNull();
        expect(side?.uri.toString()).toBe(Uri.file(ws.path("a.txt")).toString());
    });

    it("фокус в диффе даёт textViewFocus и textInputFocus живой стороны", async () => {
        await openDiff();
        const contextKeys = container.get(ContextKeyServiceDIToken);

        expect(contextKeys.evaluate("textViewFocus")).toBe(true);
        // Сторона — настоящий редактор: ввод работает, replace-гейт открыт.
        expect(contextKeys.evaluate("textInputFocus")).toBe(true);
        expect(contextKeys.evaluate("editorReadonly")).toBe(false);
    });

    it("команды курсора двигают каретку по диффу", async () => {
        await openDiff();

        commands.execute("cursorDown");
        commands.execute("cursorDown");
        commands.execute("cursorEnd");

        const active = editors.getActiveViewState()?.selections[0].active;
        expect(active?.line).toBe(2);
        expect(active?.character).toBeGreaterThan(0);
    });

    it("Ctrl+A и Copy кладут в буфер текст диффа без номеров строк и маркеров", async () => {
        await openDiff();

        commands.execute("editor.action.selectAll");
        await commands.execute("editor.action.clipboardCopyAction");

        const copied = await container.get(ClipboardDIToken).readText();
        expect(copied).toContain("XXbravo");
        // Гуттер остался в гуттере.
        expect(copied).not.toMatch(/^\s*\d+\s+\d+\s+[-+]/mu);
        // И плейсхолдеры свёрнутых кусков — не текст файла.
        expect(copied).not.toContain("unchanged line");
    });

    it("команды правки на диффе ничего не делают", async () => {
        await openDiff();
        const before = editors.getActiveViewState()?.document.getText();

        commands.execute("deleteLeft");
        await commands.execute("editor.action.clipboardPasteAction");

        expect(editors.getActiveViewState()?.document.getText()).toBe(before);
    });
});

describe("Workbench — вкладка diff, отказы", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "vexx-diff-fail-", files: { "a.txt": AT_HEAD } });
    });

    afterEach(() => {
        vi.useRealTimers();
        ws.dispose();
    });

    /** Собирает workbench с провайдером `git:`, чьё чтение падает. */
    async function withFailingProvider() {
        const { container, bindApp } = createTestContainer();
        const registry = new FileSystemProviderRegistry();
        registry.registerProvider("git", {
            readFile: () => Promise.reject(new Error("git недоступен")),
            onDidChangeFile: () => ({ dispose: () => undefined }),
        });
        container.bind(FileSystemProviderRegistryDIToken, () => registry);

        const workbench = container.get(WorkbenchComponentDIToken);
        const commands = container.get(CommandRegistryDIToken);
        const editors = container.get(EditorServiceDIToken);
        commands.register(ORIGINAL_RESOURCE_COMMAND, (raw) =>
            Uri.from({ scheme: "git", path: String(raw), query: '{"ref":"HEAD"}' }).toString(),
        );
        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        const app = TestApp.create(workbench.view, new Size(100, 16));
        bindApp(app.app);
        commands.execute("workbench.openFile", ws.path("a.txt"));
        await settle(0);
        return { workbench, commands, editors, app };
    }

    it("ошибка чтения оригинала не открывает вкладку и не роняет команду", async () => {
        const { workbench, commands, editors, app } = await withFailingProvider();

        commands.execute(COMPARE);
        await settle(10);
        app.render();

        expect(editors.editorCount).toBe(1);
        expect(app.backend.screenToString()).toContain("No changes to compare");
        workbench.dispose();
    });

    it("сообщение о невозможности сравнить со временем исчезает", async () => {
        const { workbench, commands, app } = await withFailingProvider();

        vi.useFakeTimers();
        commands.execute(COMPARE);
        await vi.advanceTimersByTimeAsync(COMPARE_NOTICE_MS + 10);
        vi.useRealTimers();
        app.render();

        expect(app.backend.screenToString()).not.toContain("No changes to compare");
        workbench.dispose();
    });
});

describe("Workbench — дифф без открытого файла (openDiffWithHead)", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "vexx-diff-core-", files: { "a.txt": "alpha\nBRAVO\ncharlie\ndelta\n" } });
    });

    afterEach(() => {
        ws.dispose();
    });

    /**
     * Собирает workbench, дополняя штатный реестр (в нём уже есть `file:` из
     * markersModule) провайдером `git:` — как это делает адаптер расширения.
     */
    function mountWorkbench() {
        const { container, bindApp } = createTestContainer();
        container.get(FileSystemProviderRegistryDIToken).registerProvider("git", {
            readFile: () => Promise.resolve(new TextEncoder().encode(AT_HEAD)),
            onDidChangeFile: () => ({ dispose: () => undefined }),
        });
        const workbench = container.get(WorkbenchComponentDIToken);
        const commands = container.get(CommandRegistryDIToken);
        const editors = container.get(EditorServiceDIToken);
        commands.register(ORIGINAL_RESOURCE_COMMAND, (raw) =>
            Uri.from({ scheme: "git", path: String(raw), query: '{"ref":"HEAD"}' }).toString(),
        );
        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        const app = TestApp.create(workbench.view, new Size(100, 16));
        bindApp(app.app);
        return { container, workbench, editors, app };
    }

    it("modified читается с диска: открывается одна дифф-вкладка, файловая — нет", async () => {
        const { container, workbench, editors, app } = mountWorkbench();

        const result = await openDiffWithHead(container, Uri.file(ws.path("a.txt")));
        await settle(10);
        app.render();

        expect(result).toBe("opened");
        const screen = app.backend.screenToString();
        expect(screen).toContain("a.txt ↔ HEAD");
        expect(screen).toMatch(/2-\s+bravo/u);
        expect(screen).toMatch(/2\+\s+BRAVO/u);
        // Инвариант прямого диффа: единственная вкладка — vexx-diff, файл не открыт.
        expect(editors.getPanes().map((p) => p.uri.scheme)).toEqual(["vexx-diff"]);
        workbench.dispose();
    });

    it("нечитающийся с диска файл (удалён) даёт дифф «HEAD ↔ пусто»", async () => {
        const { container, workbench, app } = mountWorkbench();

        // Расширение неизвестно языковому сервису — заодно покрывается откат
        // languageId на plaintext.
        const result = await openDiffWithHead(container, Uri.file(ws.path("gone.weird")));
        await settle(10);
        app.render();

        expect(result).toBe("opened");
        const screen = app.backend.screenToString();
        expect(screen).toContain("gone.weird ↔ HEAD");
        // Вся HEAD-версия — минусами; справа только пустая строка, ни одного
        // плюса с содержимым.
        expect(screen).toMatch(/1-\s+alpha/u);
        expect(screen).toMatch(/4-\s+delta/u);
        expect(screen).not.toMatch(/\d\+ +\S/u);
        workbench.dispose();
    });

    it("«оригинала нет» возвращается вызывающему без побочных эффектов", async () => {
        // ORIGINAL_RESOURCE_COMMAND не зарегистрирована — SCM-расширения нет.
        const { container, bindApp } = createTestContainer();
        const workbench = container.get(WorkbenchComponentDIToken);
        const editors = container.get(EditorServiceDIToken);
        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        const app = TestApp.create(workbench.view, new Size(100, 16));
        bindApp(app.app);

        const result = await openDiffWithHead(container, Uri.file(ws.path("a.txt")));
        app.render();

        expect(result).toBe("no-original");
        expect(editors.editorCount).toBe(0);
        expect(app.backend.screenToString()).not.toContain("No changes to compare");
        workbench.dispose();
    });
});

describe("Workbench — дифф на широком терминале (side-by-side)", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "vexx-diff-wide-", files: { "a.txt": AT_HEAD } });
    });

    afterEach(() => {
        ws.dispose();
    });

    /** Тот же стенд, что и в основном блоке, но терминал шире порога режима. */
    async function mountWide() {
        const { container, bindApp } = createTestContainer();
        const registry = new FileSystemProviderRegistry();
        registry.registerProvider("git", {
            readFile: () => Promise.resolve(new TextEncoder().encode(AT_HEAD)),
            onDidChangeFile: () => ({ dispose: () => undefined }),
        });
        container.bind(FileSystemProviderRegistryDIToken, () => registry);
        const workbench = container.get(WorkbenchComponentDIToken);
        const commands = container.get(CommandRegistryDIToken);
        const editors = container.get(EditorServiceDIToken);
        commands.register(ORIGINAL_RESOURCE_COMMAND, (raw) =>
            Uri.from({ scheme: "git", path: String(raw), query: '{"ref":"HEAD"}' }).toString(),
        );
        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        const app = TestApp.create(workbench.view, new Size(150, 16));
        bindApp(app.app);
        commands.execute("workbench.openFile", ws.path("a.txt"));
        await settle(0);
        return { workbench, commands, editors, app };
    }

    it("команда открывает две колонки с подписями сторон и выровненной правкой", async () => {
        const { workbench, commands, editors, app } = await mountWide();
        const editor = editors.getActiveEditor();
        editor?.goToPosition(1, 0);
        editor?.viewState.type("XX");

        commands.execute(COMPARE);
        await settle(10);
        app.render();

        const lines = app.backend
            .screenToString()
            .split("\n")
            .map((l) => l.replace(/\s+$/, ""));
        // Заголовок сторон (US-14): слева HEAD, справа имя файла, между ними
        // разделитель. Строку табов («a.txt ↔ HEAD ×») отсекаем по «↔».
        const header = lines.find((l) => l.includes("HEAD") && l.includes("│") && !l.includes("↔"));
        expect(header).toBeDefined();
        expect(header).toContain("a.txt");
        expect(header?.indexOf("HEAD")).toBeLessThan(header?.indexOf("a.txt") ?? -1);
        // Правка стоит парой на одной строке разделителя: слева `2-` со старой
        // строкой, справа `2+` с новой.
        const pair = lines.find((l) => /2-\s+bravo/u.test(l));
        expect(pair).toBeDefined();
        expect(pair).toMatch(/2\+\s+XXbravo/u);
        expect(pair).toContain("│");
        workbench.dispose();
    });
});

describe("Workbench — вкладка diff, вырожденные случаи", () => {
    it("без активного редактора команда просто ничего не делает", async () => {
        const ws = createTempWorkspace({ prefix: "vexx-diff-empty-", files: {} });
        const { container, bindApp } = createTestContainer();
        const workbench = container.get(WorkbenchComponentDIToken);
        const commands = container.get(CommandRegistryDIToken);
        const editors = container.get(EditorServiceDIToken);
        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        bindApp(TestApp.create(workbench.view, new Size(80, 10)).app);

        expect(editors.editorCount).toBe(0);
        expect(() => {
            commands.execute(COMPARE);
        }).not.toThrow();
        await settle(10);

        expect(editors.editorCount).toBe(0);
        workbench.dispose();
        ws.dispose();
    });

    it("SCM дало ресурс, но провайдера схемы нет — вкладка не открывается", async () => {
        // Расширение объявило git:-ресурс, а провайдер ещё не зарегистрировался.
        const ws = createTempWorkspace({ prefix: "vexx-diff-noprov-", files: { "a.txt": AT_HEAD } });
        const { container, bindApp } = createTestContainer();
        container.bind(FileSystemProviderRegistryDIToken, () => new FileSystemProviderRegistry());
        const workbench = container.get(WorkbenchComponentDIToken);
        const commands = container.get(CommandRegistryDIToken);
        const editors = container.get(EditorServiceDIToken);
        commands.register(ORIGINAL_RESOURCE_COMMAND, (raw) =>
            Uri.from({ scheme: "git", path: String(raw) }).toString(),
        );
        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        bindApp(TestApp.create(workbench.view, new Size(80, 10)).app);
        commands.execute("workbench.openFile", ws.path("a.txt"));
        await settle(0);

        commands.execute(COMPARE);
        await settle(10);

        expect(editors.editorCount).toBe(1);
        workbench.dispose();
        ws.dispose();
    });

    it("SCM ответило «оригинала нет» — вкладка не открывается", async () => {
        const ws = createTempWorkspace({ prefix: "vexx-diff-none-", files: { "a.txt": AT_HEAD } });
        const { container, bindApp } = createTestContainer();
        const registry = new FileSystemProviderRegistry();
        registry.registerProvider("git", {
            readFile: () => Promise.resolve(new TextEncoder().encode(AT_HEAD)),
            onDidChangeFile: () => ({ dispose: () => undefined }),
        });
        container.bind(FileSystemProviderRegistryDIToken, () => registry);
        const workbench = container.get(WorkbenchComponentDIToken);
        const commands = container.get(CommandRegistryDIToken);
        const editors = container.get(EditorServiceDIToken);
        // Так отвечает git-расширение про untracked-файл.
        commands.register(ORIGINAL_RESOURCE_COMMAND, () => null);
        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        bindApp(TestApp.create(workbench.view, new Size(80, 10)).app);
        commands.execute("workbench.openFile", ws.path("a.txt"));
        await settle(0);

        commands.execute(COMPARE);
        await settle(10);

        expect(editors.editorCount).toBe(1);
        workbench.dispose();
        ws.dispose();
    });
});
