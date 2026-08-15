import { describe, expect, it } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { CommandRegistry, CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../platform/configuration/common/nullConfigurationService.ts";
import { createTestContainer } from "../../diode/modules/testProfile.ts";
import { themeTypeLabel } from "../contrib/themes/browser/themeActions.ts";
import { ThemeService } from "../services/themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../services/themes/common/themeTokens.ts";

import { WorkbenchComponent, WorkbenchComponentDIToken } from "./workbenchComponent.ts";

interface ThemeContext {
    testApp: TestApp;
    workbench: WorkbenchComponent;
    commands: CommandRegistry;
    themeService: ThemeService;
    writes: { key: string; value: unknown }[];
}

function createThemeApp(writes: { key: string; value: unknown }[] = []): ThemeContext {
    const { container, bindApp } = createTestContainer();
    // Config with a recording updateUserValue so we can assert persistence wiring.
    container.bind(IConfigurationServiceDIToken, () => ({
        ...NULL_CONFIGURATION_SERVICE,
        updateUserValue: (key: string, value: unknown) => {
            writes.push({ key, value });
            return Promise.resolve();
        },
    }));
    const workbench = container.get(WorkbenchComponentDIToken);
    workbench.mount();
    const testApp = TestApp.create(workbench.view, new Size(80, 24));
    bindApp(testApp.app);
    const commands = container.get(CommandRegistryDIToken);
    const themeService = container.get(ThemeServiceDIToken);
    return { testApp, workbench, commands, themeService, writes };
}

const flush = (): Promise<void> =>
    new Promise((r) => {
        queueMicrotask(r);
    });

describe("Workbench color-theme picker", () => {
    it("registers the select-theme command", () => {
        const { commands } = createThemeApp();
        expect(commands.listCommands().some((c) => c.id === "workbench.action.selectTheme")).toBe(true);
    });

    it("previews a theme live as you navigate, then reverts on Escape", async () => {
        const { commands, themeService, testApp } = createThemeApp();
        expect(themeService.theme.name).toBe("Dark+");

        commands.execute("workbench.action.selectTheme");
        // Picker opens pre-highlighted on the current theme (Dark+). Arrow down to
        // the next theme (Monokai) → live preview applies it immediately.
        testApp.sendKey("ArrowDown");
        expect(themeService.theme.name).toBe("Monokai");

        // Escape restores the theme that was active before the picker opened.
        testApp.sendKey("Escape");
        await flush();
        expect(themeService.theme.name).toBe("Dark+");
    });

    it("applies and persists the picked theme on Enter", async () => {
        const writes: { key: string; value: unknown }[] = [];
        const { commands, themeService, testApp } = createThemeApp(writes);

        commands.execute("workbench.action.selectTheme");
        // Dark+ (1) → Monokai (2) → Light Modern (3)
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        testApp.sendKey("Enter");
        await flush();

        expect(themeService.theme.name).toBe("Light Modern");
        expect(writes).toEqual([{ key: "workbench.colorTheme", value: "Light Modern" }]);
    });

    it("does not preview anything while the query filters every theme out", async () => {
        const { commands, themeService, testApp } = createThemeApp();
        expect(themeService.theme.name).toBe("Dark+");

        commands.execute("workbench.action.selectTheme");
        // A query that matches no theme → the picker reports no active item, so the
        // live-preview callback gets `undefined` and leaves the current theme alone.
        for (const ch of "zzzz") testApp.sendKey(ch);
        expect(themeService.theme.name).toBe("Dark+");

        testApp.sendKey("Escape");
        await flush();
        expect(themeService.theme.name).toBe("Dark+");
    });
});

describe("themeTypeLabel", () => {
    it("maps each base theme type to its picker description", () => {
        expect(themeTypeLabel("dark")).toBe("dark");
        expect(themeTypeLabel("light")).toBe("light");
        expect(themeTypeLabel("hc")).toBe("high contrast");
        expect(themeTypeLabel("hcLight")).toBe("high contrast light");
    });
});
