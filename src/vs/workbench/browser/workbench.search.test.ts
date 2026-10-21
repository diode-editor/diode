import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { settle } from "../../../TestUtils/timing.ts";
import { createTestContainer } from "../../diode/modules/testProfile.ts";
import { CommandRegistry, CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";

import type { SidebarService } from "./parts/sidebar/sidebarService.ts";
import { SidebarServiceDIToken } from "./parts/sidebar/sidebarService.ts";
import { WorkbenchComponent, WorkbenchComponentDIToken } from "./workbenchComponent.ts";

const SHOW_SEARCH = "workbench.view.search";
const SHOW_EXPLORER = "workbench.view.explorer";

describe("Workbench: Search viewlet in the sidebar", () => {
    let ws: ITempWorkspace;
    let workbench: WorkbenchComponent;
    let commands: CommandRegistry;
    let sidebar: SidebarService;
    let testApp: TestApp;

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "diode-search-view-", files: { "a.txt": "foo\n" } });
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

    it("by default the sidebar shows Explorer, not Search", () => {
        testApp.render();
        expect(sidebar.getActiveViewletId()).toBe("explorer");
        expect(testApp.backend.screenToString()).toContain("EXPLORER");
    });

    it("workbench.view.search shows Search in the sidebar and focuses the query", () => {
        commands.execute(SHOW_SEARCH);
        testApp.render();
        expect(sidebar.getActiveViewletId()).toBe("search");
        expect(testApp.backend.screenToString()).toContain("SEARCH");
    });

    it("Down from the query input moves focus to the results list (ring, full key path)", () => {
        commands.execute(SHOW_SEARCH);
        testApp.render();
        const query = testApp.querySelector("InputElement");
        expect(testApp.app.focusManager?.activeElement).toBe(query);

        testApp.sendKey("ArrowDown");
        testApp.render();
        expect(testApp.app.focusManager?.activeElement?.id).toBe("searchResults");
    });

    it("Ctrl+Down works like Down (parity with VS Code)", () => {
        commands.execute(SHOW_SEARCH);
        testApp.render();
        testApp.sendKey("Ctrl+ArrowDown");
        testApp.render();
        expect(testApp.app.focusManager?.activeElement?.id).toBe("searchResults");
    });

    it("switching Explorer ↔ Search changes the sidebar content", () => {
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
