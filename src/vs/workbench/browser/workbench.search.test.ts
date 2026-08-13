import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "@tuidom/all/common/geometryPromitives";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { settle } from "../../../TestUtils/timing.ts";
import { CommandRegistry, CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { createTestContainer } from "../../vexx/modules/testProfile.ts";

import type { SidebarService } from "./parts/sidebar/sidebarService.ts";
import { SidebarServiceDIToken } from "./parts/sidebar/sidebarService.ts";
import { WorkbenchComponent, WorkbenchComponentDIToken } from "./workbenchComponent.ts";

/**
 * Search — один из вьюлетов сайдбара (наряду с Explorer и Source Control):
 * команда `workbench.view.search` подменяет содержимое сайдбара на вид Search и
 * фокусирует строку запроса. Гейт «до кадра» на настоящем WorkbenchComponent.
 */

const SHOW_SEARCH = "workbench.view.search";
const SHOW_EXPLORER = "workbench.view.explorer";

describe("Workbench — вьюлет Search в сайдбаре", () => {
    let ws: ITempWorkspace;
    let workbench: WorkbenchComponent;
    let commands: CommandRegistry;
    let sidebar: SidebarService;
    let testApp: TestApp;

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "vexx-search-view-", files: { "a.txt": "foo\n" } });
        const { container, bindApp } = createTestContainer();
        workbench = container.get(WorkbenchComponentDIToken);
        commands = container.get(CommandRegistryDIToken);
        sidebar = container.get(SidebarServiceDIToken);

        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        testApp = TestApp.create(workbench.view, new Size(100, 20));
        bindApp(testApp.app);
        await settle(0);
    });

    afterEach(() => {
        workbench.dispose();
        ws.dispose();
    });

    it("по умолчанию сайдбар показывает Explorer, а не Search", () => {
        testApp.render();
        expect(sidebar.getActiveViewletId()).toBe("explorer");
        expect(testApp.backend.screenToString()).toContain("EXPLORER");
    });

    it("workbench.view.search показывает Search в сайдбаре и фокусирует запрос", () => {
        commands.execute(SHOW_SEARCH);
        testApp.render();
        expect(sidebar.getActiveViewletId()).toBe("search");
        expect(testApp.backend.screenToString()).toContain("SEARCH");
    });

    it("Down из строки запроса уводит фокус в список результатов (кольцо, полный путь клавиши)", () => {
        commands.execute(SHOW_SEARCH);
        testApp.render();
        const query = testApp.querySelector("InputElement");
        expect(testApp.app.focusManager?.activeElement).toBe(query);

        testApp.sendKey("ArrowDown");
        testApp.render();
        expect(testApp.app.focusManager?.activeElement?.id).toBe("searchResults");
    });

    it("Ctrl+Down работает как Down (паритет с VS Code)", () => {
        commands.execute(SHOW_SEARCH);
        testApp.render();
        testApp.sendKey("Ctrl+ArrowDown");
        testApp.render();
        expect(testApp.app.focusManager?.activeElement?.id).toBe("searchResults");
    });

    it("переключение Explorer ↔ Search меняет содержимое сайдбара", () => {
        commands.execute(SHOW_SEARCH);
        testApp.render();
        expect(testApp.backend.screenToString()).toContain("SEARCH");

        commands.execute(SHOW_EXPLORER);
        testApp.render();
        expect(sidebar.getActiveViewletId()).toBe("explorer");
        const screen = testApp.backend.screenToString();
        expect(screen).toContain("EXPLORER");
        expect(screen).not.toContain("SEARCH");
    });
});
