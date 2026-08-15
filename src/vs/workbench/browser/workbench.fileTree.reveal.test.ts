import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import type { CommandRegistry } from "../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../platform/configuration/common/nullConfigurationService.ts";
import { createTestContainer } from "../../vexx/modules/testProfile.ts";
import type { EditorService } from "../services/editor/browser/editorService.ts";

import { WorkbenchComponent, WorkbenchComponentDIToken } from "./workbenchComponent.ts";

function createNestedWorkspace(): ITempWorkspace {
    return createTempWorkspace({
        prefix: "vexx-reveal-int-",
        files: {
            "src/deep/target.ts": "export const x = 1;",
            "README.md": "# Readme",
        },
    });
}

/** Конфиг-стаб: заданные ключи возвращают свои значения, остальные — default. */
function stubConfig(values: Record<string, unknown>): IConfigurationService {
    return {
        ...NULL_CONFIGURATION_SERVICE,
        get<T>(key: string, defaultValue?: T): T | undefined {
            if (key in values) return values[key] as T;
            return defaultValue;
        },
    };
}

interface Ctx {
    testApp: TestApp;
    workbench: WorkbenchComponent;
    commands: CommandRegistry;
}

// Не через createAppTestHarness: конфиг-стаб должен быть забинжен ДО резолва
// Workbench (контроллер читает IConfigurationService в конструкторе,
// а контейнер кэширует уже созданные сервисы).
function createApp(workspaceDir: string, config?: IConfigurationService): Ctx {
    const { container, bindApp } = createTestContainer();
    if (config) {
        container.bind(IConfigurationServiceDIToken, () => config);
    }
    const workbench = container.get(WorkbenchComponentDIToken);
    workbench.setWorkspaceFolder(workspaceDir);
    workbench.mount();
    const testApp = TestApp.create(workbench.view, new Size(80, 24));
    bindApp(testApp.app);
    return { testApp, workbench, commands: container.get(CommandRegistryDIToken) };
}

// The reveal is scheduled fire-and-forget (void promise); let its microtasks settle.
function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 20));
}

describe("reveal active file in explorer", () => {
    let ws: ITempWorkspace;
    let nestedFile: string;

    beforeEach(() => {
        ws = createNestedWorkspace();
        nestedFile = path.join(ws.dir, "src", "deep", "target.ts");
    });

    afterEach(() => {
        ws.dispose();
    });

    it("auto-reveals the active file in the tree when the editor changes", async () => {
        const ctx = createApp(ws.dir);
        await ctx.workbench.activate();
        ctx.testApp.render();

        // Nested file is inside a collapsed directory — not visible yet.
        expect(ctx.testApp.backend.screenToString()).not.toContain("target.ts");

        // Open it via a non-tree path (e.g. Quick Open). autoReveal defaults to true.
        ctx.workbench.openFile(nestedFile);
        await flush();
        ctx.testApp.render();

        expect(ctx.testApp.backend.screenToString()).toContain("deep");
        ctx.workbench.dispose();
    });

    it("treats a missing explorer.autoReveal setting as enabled", async () => {
        // A config whose get() always yields undefined exercises the `?? true` fallback.
        const ctx = createApp(ws.dir, { ...NULL_CONFIGURATION_SERVICE, get: () => undefined });
        await ctx.workbench.activate();
        ctx.testApp.render();

        ctx.workbench.openFile(nestedFile);
        await flush();
        ctx.testApp.render();

        expect(ctx.testApp.backend.screenToString()).toContain("deep");
        ctx.workbench.dispose();
    });

    it("does not auto-reveal when explorer.autoReveal is false", async () => {
        const ctx = createApp(ws.dir, stubConfig({ "explorer.autoReveal": false }));
        await ctx.workbench.activate();
        ctx.testApp.render();

        ctx.workbench.openFile(nestedFile);
        await flush();
        ctx.testApp.render();

        // Directory stays collapsed — the ancestor dir is never expanded in the tree.
        // (the editor tab shows the file name, so assert on the tree-only "deep" dir instead)
        expect(ctx.testApp.backend.screenToString()).not.toContain("deep");
        ctx.workbench.dispose();
    });

    it("reveal command shows the sidebar, focuses the tree, and reveals the active file", async () => {
        const ctx = createApp(ws.dir);
        await ctx.workbench.activate();
        ctx.testApp.render();

        ctx.workbench.openFile(nestedFile);
        await flush();

        // Hide the sidebar and move focus into the editor.
        ctx.testApp.sendKey("Ctrl+B");
        ctx.testApp.render();
        expect(ctx.workbench.workbenchLayout.getLeftPanelVisible()).toBe(false);

        ctx.commands.execute("workbench.files.action.showActiveFileInExplorer");
        await flush();
        ctx.testApp.render();

        expect(ctx.workbench.workbenchLayout.getLeftPanelVisible()).toBe(true);
        expect(ctx.testApp.focusedElement?.constructor.name).toBe("TreeViewElement");
        expect(ctx.testApp.backend.screenToString()).toContain("deep");
        ctx.workbench.dispose();
    });

    it("reveal command is a no-op when there is no active editor", async () => {
        const ctx = createApp(ws.dir);
        await ctx.workbench.activate();
        ctx.testApp.render();

        const editorGroup = (ctx.workbench as unknown as { editorService: EditorService }).editorService;
        expect(editorGroup.getActiveEditor()).toBeNull();
        expect(() => ctx.commands.execute("workbench.files.action.showActiveFileInExplorer")).not.toThrow();
        // Sidebar stays as-is (visible by default), nothing is revealed.
        expect(ctx.workbench.workbenchLayout.getLeftPanelVisible()).toBe(true);
        ctx.workbench.dispose();
    });
});
