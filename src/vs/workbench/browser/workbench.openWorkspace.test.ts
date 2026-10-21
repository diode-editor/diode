import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { quickPickByTitle } from "../../../TestUtils/domQueries.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../TestUtils/timing.ts";
import { IWorkspaceContextServiceDIToken } from "../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";

describe("Workbench — Open Workspace from File", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-open-ws-",
            files: {
                "web.code-workspace": '{ "folders": [{ "path": "packages/web", "name": "Web" }] }',
                "multi.code-workspace": '{ "folders": [{ "path": "a" }, { "path": "b" }] }',
                "gone.code-workspace": '{ "folders": [{ "path": "nowhere" }] }',
                "notes.txt": "x",
                "packages/web/index.ts": "export {};\n",
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function prompt(): ReturnType<typeof quickPickByTitle> {
        h.commands.execute("workbench.action.openWorkspace");
        h.testApp.render();
        return quickPickByTitle(h.testApp, "Open Workspace from File");
    }

    async function accept(value: string): Promise<void> {
        const input = prompt();
        input.onQueryChange?.(value);
        input.setQuery(value);
        await vi.waitFor(() => {
            expect(input.validationMessage).toBeNull();
        });
        h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(h.container.get(IWorkspaceContextServiceDIToken).getWorkbenchState()).toBe("workspace");
        });
    }

    it("каждая причина, по которой файл не открыть, — сообщением прямо в поле", async () => {
        const input = prompt();
        const cases: [string, string][] = [
            [ws.path("notes.txt"), `Not a workspace file (*.code-workspace): ${ws.path("notes.txt")}`],
            [
                ws.path("missing.code-workspace"),
                `Workspace file does not exist or cannot be read: ${ws.path("missing.code-workspace")}`,
            ],
            [ws.path("multi.code-workspace"), "multi-root workspaces are not supported yet"],
            [ws.path("gone.code-workspace"), `Workspace folder does not exist: ${ws.path("nowhere")}`],
        ];
        for (const [value, message] of cases) {
            input.onQueryChange?.(value);
            await vi.waitFor(() => {
                expect(input.validationMessage).toContain(message);
            });
        }

        // Пустое поле ошибкой не помечается — как у Open Folder.
        input.onQueryChange?.("");
        await vi.waitFor(() => {
            expect(input.validationMessage).toBeNull();
        });
    });

    it("принятый файл открывает воркспейс: папка из файла, файл — в configuration", async () => {
        await accept("web.code-workspace");

        const workspace = h.container.get(IWorkspaceContextServiceDIToken).getWorkspace();
        expect(workspace.configuration?.fsPath).toBe(ws.path("web.code-workspace"));
        expect(workspace.folders.map((f) => [f.uri.fsPath, f.name])).toEqual([[ws.path("packages/web"), "Web"]]);
    });

    it("поле подсказывает, какой файл ждут", () => {
        expect(prompt().placeholder).toBe("Enter a .code-workspace file path");
    });

    // Команда возвращает промис: отказ внутри неё дошёл бы сюда, а не потерялся.
    it("Escape и пустой Enter ничего не открывают, команда завершается без отказа", async () => {
        const escaped = h.commands.execute("workbench.action.openWorkspace");
        h.testApp.render();
        const input = quickPickByTitle(h.testApp, "Open Workspace from File");
        input.onQueryChange?.(ws.path("web.code-workspace"));
        input.setQuery(ws.path("web.code-workspace"));
        h.testApp.sendKey("Escape");
        await expect(escaped).resolves.toBeUndefined();

        const emptied = h.commands.execute("workbench.action.openWorkspace");
        h.testApp.render();
        quickPickByTitle(h.testApp, "Open Workspace from File").onQueryChange?.("");
        h.testApp.sendKey("Enter");
        await expect(emptied).resolves.toBeUndefined();
        await flushMicrotasks();

        expect(h.container.get(IWorkspaceContextServiceDIToken).getWorkbenchState()).toBe("folder");
        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(false);
    });
});
