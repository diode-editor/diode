import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "@tuidom/all/common/geometryPromitives";
import { TreeViewElement } from "@tuidom/all/ui/tree/treeViewElement";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { settle } from "../../../TestUtils/timing.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";
import { CommandRegistry, CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { createTestContainer } from "../../vexx/modules/testProfile.ts";
import { SettingsResourceDIToken } from "../common/coreTokens.ts";
import { ProblemsComponent, ProblemsComponentDIToken } from "../contrib/markers/browser/problemsComponent.ts";
import { ThemeServiceDIToken } from "../services/themes/common/themeTokens.ts";

import { WorkbenchComponent, WorkbenchComponentDIToken } from "./workbenchComponent.ts";

const UNKNOWN_SETTINGS = ["{", '    "editor.tabSize": 2,', '    "editor.fontSize": 12', "}"].join("\n");

const flush = (): Promise<void> => settle(0);

describe("Workbench — Problems view end-to-end", () => {
    let ws: ITempWorkspace;
    let workbench: WorkbenchComponent;
    let commands: CommandRegistry;
    let testApp: TestApp;
    let problems: ProblemsComponent;
    let panelBg: number;
    let settingsPath: string;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "vexx-problems-e2e-",
            files: { "settings.json": UNKNOWN_SETTINGS },
        });
        settingsPath = ws.path("settings.json");

        // Харнесс здесь не подходит: SettingsResourceDIToken надо перебиндить
        // ДО первого get(WorkbenchComponentDIToken), а харнесс резолвит контроллер сразу.
        const { container, bindApp } = createTestContainer();
        container.bind(SettingsResourceDIToken, () => settingsPath);
        workbench = container.get(WorkbenchComponentDIToken);
        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        testApp = TestApp.create(workbench.view, new Size(90, 22));
        bindApp(testApp.app);
        commands = container.get(CommandRegistryDIToken);
        problems = container.get(ProblemsComponentDIToken);
        panelBg = container.get(ThemeServiceDIToken).theme.getRequiredColor("panel.background");
    });

    afterEach(() => {
        workbench.dispose();
        ws.dispose();
    });

    it("paints, focuses and keyboard-navigates the Problems tree (regression: 3 bugs)", async () => {
        commands.execute("workbench.openFile", settingsPath); // produces a marker via the settings validator
        await flush();
        testApp.render();
        commands.execute("workbench.actions.view.problems");
        await flush();
        testApp.render();

        const screen = testApp.backend.screenToString();
        expect(screen).toContain("settings.json  (1)");
        expect(screen).toContain("Unknown Configuration Setting: editor.fontSize");

        // E2E-шов DiagnosticsService → EditorService: маркер того же
        // валидатора дошёл и до squiggle-декораций открытого редактора.
        const editorElement = testApp.querySelector("EditorElement") as EditorElement;
        expect(editorElement.markerDecorations).toHaveLength(1);

        // Bug 1 — the panel subtree's style is resolved (tree bg = panel bg, not the
        // unresolved default), so the tree area is actually painted.
        expect(problems.tree.resolvedStyle.bg).toBe(panelBg);

        // Bug 2 — the tree captured focus (both as active element and visually).
        expect(workbench.view.focusManager?.activeElement).toBeInstanceOf(TreeViewElement);
        expect(problems.tree.isFocused).toBe(true);

        // Bug 3 — keyboard navigation works: ArrowDown moves the selection.
        const before = problems.tree.getSelectedNode();
        testApp.sendKey("ArrowDown");
        await flush();
        testApp.render();
        expect(problems.tree.getSelectedNode()).not.toEqual(before);
    });

    it("shows the empty-state placeholder when there are no problems", () => {
        commands.execute("workbench.actions.view.problems");
        testApp.render();
        expect(testApp.backend.screenToString()).toContain("No problems have been detected in the workspace.");
    });
});
