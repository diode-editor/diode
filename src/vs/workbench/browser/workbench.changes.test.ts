import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "../../../../tuidom/common/geometryPromitives.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { settle } from "../../../TestUtils/timing.ts";
import { Uri } from "../../base/common/uri.ts";
import { CommandRegistry, CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { FileSystemProviderRegistry } from "../../platform/files/common/fileSystemProviderRegistry.ts";
import { createTestContainer } from "../../vexx/modules/testProfile.ts";
import { FileSystemProviderRegistryDIToken } from "../common/coreTokens.ts";
import type { ChangesComponent } from "../contrib/scm/browser/changesComponent.ts";
import { ChangesComponentDIToken } from "../contrib/scm/browser/changesComponent.ts";
import type { ScmChangesService } from "../contrib/scm/browser/changesService.ts";
import { PUBLISH_CHANGES_COMMAND, ScmChangesServiceDIToken } from "../contrib/scm/browser/changesService.ts";
import { ORIGINAL_RESOURCE_COMMAND } from "../contrib/scm/browser/commandOriginalResourceProvider.ts";
import type { EditorService } from "../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/browser/editorService.ts";
import { ThemeServiceDIToken } from "../services/themes/common/themeTokens.ts";

import type { SidebarService } from "./parts/sidebar/sidebarService.ts";
import { SidebarServiceDIToken } from "./parts/sidebar/sidebarService.ts";
import { WorkbenchComponent, WorkbenchComponentDIToken } from "./workbenchComponent.ts";

/**
 * Сквозной гейт этапа 6 «до кадра»: SCM-расширение (заглушка) публикует набор
 * изменённых файлов командой `vexx.scm.publishChanges`, а вьюлет **Source
 * Control** в сайдбаре (вместо Explorer, переключение командой `workbench.view.scm`)
 * показывает их списком; активация файла открывает дифф этапа 5. Роль git играют
 * заглушки (`git:`-провайдер + `originalResource`), путь ядра — настоящий.
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
    let scm: ScmChangesService;
    let sidebar: SidebarService;
    let sideBg: number;
    let testApp: TestApp;

    /** Публикует набор изменений так же, как это делает git-расширение. */
    function publish(entries: { path: string; rel: string; status: string; colorId: string }[]): void {
        commands.execute(
            PUBLISH_CHANGES_COMMAND,
            entries.map((e) => ({
                uri: Uri.file(e.path).toString(),
                status: e.status,
                colorId: e.colorId,
                path: e.rel,
            })),
        );
    }

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "vexx-changes-", files: { "a.txt": AT_HEAD } });

        const { container, bindApp } = createTestContainer();
        const registry = new FileSystemProviderRegistry();
        registry.registerProvider("git", {
            readFile: () => Promise.resolve(new TextEncoder().encode(AT_HEAD)),
            onDidChangeFile: () => ({ dispose: () => undefined }),
        });
        container.bind(FileSystemProviderRegistryDIToken, () => registry);

        workbench = container.get(WorkbenchComponentDIToken);
        commands = container.get(CommandRegistryDIToken);
        editors = container.get(EditorServiceDIToken);
        changes = container.get(ChangesComponentDIToken);
        scm = container.get(ScmChangesServiceDIToken);
        sidebar = container.get(SidebarServiceDIToken);
        sideBg = container.get(ThemeServiceDIToken).theme.getRequiredColor("sideBar.background");
        commands.register(ORIGINAL_RESOURCE_COMMAND, (raw) =>
            Uri.from({ scheme: "git", path: String(raw), query: '{"ref":"HEAD"}' }).toString(),
        );

        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        testApp = TestApp.create(workbench.view, new Size(100, 20));
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
            { path: ws.path("nested/b.txt"), rel: "nested/b.txt", status: "U", colorId: UNTRACKED },
        ]);
        commands.execute(SHOW_SCM);
        await settle(0);
        testApp.render();

        const screen = testApp.backend.screenToString();
        expect(sidebar.getActiveViewletId()).toBe("scm");
        expect(screen).toContain("SOURCE CONTROL");
        expect(screen).toContain("nested/b.txt");
        // Дерево покрашено темой сайдбара (bg = sideBar bg), а не дефолтом — отрисовано.
        expect(changes.tree.resolvedStyle.bg).toBe(sideBg);
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

    it("активация файла открывает дифф этапа 5 (файл ↔ HEAD)", async () => {
        // Правим буфер, не сохраняя: дифф должен показать несохранённое.
        const editor = editors.getActiveEditor();
        editor?.goToPosition(1, 0);
        editor?.viewState.type("XX");

        publish([{ path: ws.path("a.txt"), rel: "a.txt", status: "M", colorId: MODIFIED }]);
        commands.execute(SHOW_SCM);
        await settle(0);

        // Активируем узел файла — тот же обработчик, что зовёт клик/Enter по списку.
        changes.tree.onActivate?.(scm.changes[0]);
        await settle(10);
        testApp.render();

        const screen = testApp.backend.screenToString();
        expect(screen).toContain("a.txt ↔ HEAD");
        expect(screen).toContain("-  bravo");
        expect(screen).toContain("+  XXbravo");
    });
});
