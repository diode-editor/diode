import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { settle } from "../../../TestUtils/timing.ts";
import { Uri } from "../../base/common/uri.ts";
import { CommandRegistry, CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { createTestContainer } from "../../diode/modules/testProfile.ts";
import { FileSystemProviderRegistryDIToken } from "../common/coreTokens.ts";
import type { ChangesComponent } from "../contrib/scm/browser/changesComponent.ts";
import { ChangesComponentDIToken } from "../contrib/scm/browser/changesComponent.ts";
import { PUBLISH_CHANGES_COMMAND } from "../contrib/scm/browser/changesService.ts";
import { ORIGINAL_RESOURCE_COMMAND } from "../contrib/scm/browser/commandOriginalResourceProvider.ts";
import type { EditorService } from "../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/browser/editorService.ts";
import { ThemeServiceDIToken } from "../services/themes/common/themeTokens.ts";

import type { SidebarService } from "./parts/sidebar/sidebarService.ts";
import { SidebarServiceDIToken } from "./parts/sidebar/sidebarService.ts";
import { WorkbenchComponent, WorkbenchComponentDIToken } from "./workbenchComponent.ts";

/**
 * Сквозной гейт этапа 6 «до кадра»: SCM-расширение (заглушка) публикует набор
 * изменённых файлов командой `diode.scm.publishChanges`, а вьюлет **Source
 * Control** в сайдбаре (вместо Explorer, переключение командой `workbench.view.scm`)
 * показывает их списком; активация файла открывает дифф этапа 5 напрямую, без
 * промежуточной файловой вкладки. Роль git играют заглушки (`git:`-провайдер +
 * `originalResource`), путь ядра — настоящий.
 */

const AT_HEAD = "alpha\nbravo\ncharlie\ndelta\n";
const SHOW_SCM = "workbench.view.scm";
const SHOW_EXPLORER = "workbench.view.explorer";
const MODIFIED = "gitDecoration.modifiedResourceForeground";
const UNTRACKED = "gitDecoration.untrackedResourceForeground";

describe("Workbench — Source Control в сайдбаре end-to-end", () => {
    let ws: ITempWorkspace;
    let workbench: WorkbenchComponent;
    let commands: CommandRegistry;
    let editors: EditorService;
    let changes: ChangesComponent;
    let sidebar: SidebarService;
    let sideBg: number;
    let testApp: TestApp;

    /** Публикует набор изменений так же, как это делает git-расширение. */
    function publish(entries: { path: string; rel: string; status: string; colorId: string; group?: string }[]): void {
        commands.execute(
            PUBLISH_CHANGES_COMMAND,
            entries.map((e) => ({
                uri: Uri.file(e.path).toString(),
                status: e.status,
                colorId: e.colorId,
                path: e.rel,
                group: e.group ?? "worktree",
            })),
        );
    }

    /** Активирует строку списка клавиатурным путём: курсор на строку → Enter. */
    function activate(rel: string, group = "worktree"): void {
        changes.list.setCursorTo(`scmRow-${group}-${rel.replace(/[^A-Za-z0-9_-]+/g, "-")}`);
        changes.list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));
    }

    /**
     * Поллит кадр до предиката: открытие диффа читает диск асинхронно, и
     * фиксированная пауза флачит на медленных CI-раннерах под coverage.
     * По таймауту возвращает последний кадр — ассерт упадёт с внятным диффом.
     */
    async function waitForScreen(predicate: (screen: string) => boolean, timeoutMs = 5000): Promise<string> {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            testApp.render();
            const screen = testApp.backend.screenToString();
            if (predicate(screen) || Date.now() > deadline) return screen;
            await settle(10);
        }
    }

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "vexx-changes-",
            files: { "a.txt": AT_HEAD, "nested/b.txt": "b-on-disk\n", "untracked.txt": "brand new\n" },
        });

        const { container, bindApp } = createTestContainer();
        // Дополняем штатный реестр (в нём уже есть file: из markersModule)
        // git:-провайдером — как это делает адаптер расширения. Untracked-файлу
        // originalResource отвечает null — как настоящее git-расширение.
        container.get(FileSystemProviderRegistryDIToken).registerProvider("git", {
            readFile: () => Promise.resolve(new TextEncoder().encode(AT_HEAD)),
            onDidChangeFile: () => ({ dispose: () => undefined }),
        });

        workbench = container.get(WorkbenchComponentDIToken);
        commands = container.get(CommandRegistryDIToken);
        editors = container.get(EditorServiceDIToken);
        changes = container.get(ChangesComponentDIToken);
        sidebar = container.get(SidebarServiceDIToken);
        sideBg = container.get(ThemeServiceDIToken).theme.getRequiredColor("sideBar.background");
        commands.register(ORIGINAL_RESOURCE_COMMAND, (raw) =>
            String(raw).endsWith("untracked.txt")
                ? null
                : Uri.from({ scheme: "git", path: String(raw), query: '{"ref":"HEAD"}' }).toString(),
        );

        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        // Высота с запасом: секция Source Control отдаёт 5 верхних строк
        // контролам коммита (поле, зазор, кнопка и паддинги), и на 20 строках
        // список не вмещал бы весь набор.
        testApp = TestApp.create(workbench.view, new Size(150, 26));
        bindApp(testApp.app);

        commands.execute("workbench.openFile", ws.path("a.txt"));
        await settle(0);
    });

    afterEach(() => {
        workbench.dispose();
        ws.dispose();
    });

    it("по умолчанию сайдбар показывает Explorer", () => {
        testApp.render();
        expect(sidebar.getActiveViewletId()).toBe("explorer");
        expect(testApp.backend.screenToString()).toContain("EXPLORER");
    });

    it("workbench.view.scm показывает список изменённых файлов в сайдбаре", async () => {
        publish([
            { path: ws.path("a.txt"), rel: "a.txt", status: "M", colorId: MODIFIED },
            { path: ws.path("nested/b.txt"), rel: "nested/b.txt", status: "U", colorId: UNTRACKED, group: "untracked" },
        ]);
        commands.execute(SHOW_SCM);
        await settle(0);
        testApp.render();

        const screen = testApp.backend.screenToString();
        expect(sidebar.getActiveViewletId()).toBe("scm");
        expect(screen).toContain("SOURCE CONTROL");
        expect(screen).toContain("nested/b.txt");
        // Список покрашен темой сайдбара (bg = sideBar bg), а не дефолтом — отрисован.
        expect(changes.list.resolvedStyle.bg).toBe(sideBg);
    });

    it("переключение Explorer ↔ Source Control меняет содержимое сайдбара", () => {
        commands.execute(SHOW_SCM);
        testApp.render();
        let screen = testApp.backend.screenToString();
        expect(screen).toContain("SOURCE CONTROL");
        expect(screen).not.toContain("EXPLORER");

        commands.execute(SHOW_EXPLORER);
        testApp.render();
        screen = testApp.backend.screenToString();
        expect(sidebar.getActiveViewletId()).toBe("explorer");
        expect(screen).toContain("EXPLORER");
        expect(screen).not.toContain("SOURCE CONTROL");
    });

    it("активация открытого файла показывает дифф с несохранёнными правками — одной вкладкой", async () => {
        // Правим буфер, не сохраняя: дифф должен показать несохранённое.
        const editor = editors.getActiveEditor();
        editor?.goToPosition(1, 0);
        editor?.viewState.type("XX");

        publish([{ path: ws.path("a.txt"), rel: "a.txt", status: "M", colorId: MODIFIED }]);
        commands.execute(SHOW_SCM);
        await settle(0);

        const panesBefore = editors.editorCount;
        activate("a.txt");

        const screen = await waitForScreen((s) => s.includes("a.txt ↔ HEAD"));
        expect(screen).toContain("a.txt ↔ HEAD");
        expect(screen).toMatch(/2-\s+bravo/u);
        expect(screen).toMatch(/2\+\s+XXbravo/u);
        // Ровно одна новая вкладка — дифф; файловая не открывалась (файл уже был открыт).
        expect(editors.editorCount).toBe(panesBefore + 1);
    });

    it("активация НЕоткрытого файла читает диск и открывает только дифф-вкладку", async () => {
        publish([{ path: ws.path("nested/b.txt"), rel: "nested/b.txt", status: "M", colorId: MODIFIED }]);
        commands.execute(SHOW_SCM);
        await settle(0);

        activate("nested/b.txt");

        expect(await waitForScreen((s) => s.includes("b.txt ↔ HEAD"))).toContain("b.txt ↔ HEAD");
        // Файловая вкладка b.txt не появилась — только a.txt из beforeEach и дифф.
        // fsPath не бросает на не-file схемах (дифф-вкладка несёт тот же путь) —
        // файловую вкладку отличаем схемой.
        const panes = editors.getPanes();
        expect(panes.filter((p) => p.uri.scheme === "diode-diff")).toHaveLength(1);
        expect(panes.some((p) => p.uri.scheme === "file" && p.uri.fsPath === ws.path("nested/b.txt"))).toBe(false);
    });

    it("активация untracked-файла открывает сам файл, а не notice", async () => {
        publish([
            {
                path: ws.path("untracked.txt"),
                rel: "untracked.txt",
                status: "U",
                colorId: UNTRACKED,
                group: "untracked",
            },
        ]);
        commands.execute(SHOW_SCM);
        await settle(0);

        activate("untracked.txt", "untracked");

        const screen = await waitForScreen((s) => s.includes("brand new"));
        expect(screen).toContain("brand new");
        expect(screen).not.toContain("↔ HEAD");
        expect(screen).not.toContain("No changes to compare");
        expect(editors.getPanes().some((p) => p.uri.fsPath === ws.path("untracked.txt"))).toBe(true);
    });

    it("scm.action.viewAsTree группирует по папкам, viewAsList возвращает пути", async () => {
        publish([
            { path: ws.path("a.txt"), rel: "a.txt", status: "M", colorId: MODIFIED },
            { path: ws.path("nested/b.txt"), rel: "nested/b.txt", status: "M", colorId: MODIFIED },
        ]);
        commands.execute(SHOW_SCM);
        await settle(0);

        commands.execute("scm.action.viewAsTree");
        testApp.render();
        let screen = testApp.backend.screenToString();
        expect(screen).toContain("nested");
        expect(screen).not.toContain("nested/b.txt");

        commands.execute("scm.action.viewAsList");
        testApp.render();
        screen = testApp.backend.screenToString();
        expect(screen).toContain("nested/b.txt");
    });
});
