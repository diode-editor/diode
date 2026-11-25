import { packRgb } from "@tuidom/core/common/colorUtils";
import { describe, expect, it } from "vitest";

import { Emitter } from "../../../../base/common/event.ts";
import { createConfigurationChangeEvent } from "../../../../platform/configuration/common/configurationChangeEvent.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import type {
    IConfigurationChangeEvent,
    IConfigurationService,
} from "../../../../platform/configuration/common/iConfigurationService.ts";
import { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import type { ILogService } from "../../../../platform/log/common/iLogService.ts";
import { NULL_LOGGER } from "../../../../platform/log/common/nullLogService.ts";
import type { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { CONFIGURATION_CONTRIBUTIONS } from "../../../common/configuration/configurationContributions.ts";
import type { HostColorSchemeService } from "../../../services/themes/browser/hostColorSchemeService.ts";
import type { ColorScheme } from "../../../services/themes/common/themeConfiguration.ts";
import { createBuiltinThemeRegistry } from "../../../services/themes/common/themeRegistry.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { ThemeConfigContribution } from "./themeConfigContribution.ts";

const SETTING = "workbench.colorCustomizations";

/** The in-memory service, except that `updateMany` fires one event for several keys, as a settings.json reload does. */
class BatchingConfigurationService {
    private readonly inner: InMemoryConfigurationService;
    private batch: string[] | null = null;
    private readonly emitter = new Emitter<IConfigurationChangeEvent>();
    public readonly onDidChangeConfiguration = this.emitter.event;

    public constructor(settings: Record<string, unknown>) {
        this.inner = new InMemoryConfigurationService(new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS), settings);
        this.inner.onDidChangeConfiguration((event) => {
            if (this.batch !== null) this.batch.push(...event.affectedKeys);
            else this.emitter.fire(event);
        });
    }

    public get(key: string): unknown {
        return this.inner.get(key);
    }

    public updateValue(key: string, value: unknown): Promise<void> {
        return this.inner.updateValue(key, value);
    }

    public async updateMany(values: Record<string, unknown>): Promise<void> {
        this.batch = [];
        for (const [key, value] of Object.entries(values)) await this.inner.updateValue(key, value);
        const keys = this.batch;
        this.batch = null;
        this.emitter.fire(createConfigurationChangeEvent(keys));
    }
}

function setup(settings: Record<string, unknown> = {}): {
    config: BatchingConfigurationService;
    themeService: ThemeService;
    applied: WorkbenchTheme[];
    warnings: string[];
} {
    const config = new BatchingConfigurationService(settings);
    const registry = createBuiltinThemeRegistry();
    // As main.ts does before the first frame.
    registry.setColorCustomizations(config.get(SETTING));
    const themeService = new ThemeService(registry.resolve("Dark Modern")!);
    const applied: WorkbenchTheme[] = [];
    themeService.onThemeChange((theme) => applied.push(theme));
    applied.length = 0;
    const warnings: string[] = [];
    const logService = {
        // Only the Configuration output channel counts.
        createLogger: (name: string) => ({
            ...NULL_LOGGER,
            warn: (message: string) => {
                if (name === "configuration") warnings.push(message);
            },
        }),
    } as unknown as ILogService;
    const host = { colorScheme: undefined, onDidChangeColorScheme: new Emitter<ColorScheme>().event };
    new ThemeConfigContribution(
        config as unknown as IConfigurationService,
        themeService,
        registry,
        host as unknown as HostColorSchemeService,
        logService,
    );
    return { config, themeService, applied, warnings };
}

const editorBackground = (theme: WorkbenchTheme): number => theme.getRequiredColor("editor.background");

describe("ThemeConfigContribution: workbench.colorCustomizations", () => {
    it("an edit recolors the active theme at once; removing it brings the theme's color back", async () => {
        const { config, themeService, applied } = setup();
        const original = editorBackground(themeService.theme);

        await config.updateValue(SETTING, { "editor.background": "#202020" });
        expect(applied).toHaveLength(1);
        expect(themeService.theme.name).toBe("Dark Modern");
        expect(editorBackground(themeService.theme)).toBe(packRgb(0x20, 0x20, 0x20));

        await config.updateValue(SETTING, undefined);
        expect(editorBackground(themeService.theme)).toBe(original);
    });

    it("a block for another theme takes effect when that theme becomes active", async () => {
        const { config, themeService } = setup({
            [SETTING]: { "editor.background": "#202020", "[Light Modern]": { "editor.background": "#fff8e0" } },
        });
        expect(editorBackground(themeService.theme)).toBe(packRgb(0x20, 0x20, 0x20));

        await config.updateValue("workbench.colorTheme", "Light Modern");
        expect(themeService.theme.name).toBe("Light Modern");
        expect(editorBackground(themeService.theme)).toBe(packRgb(0xff, 0xf8, 0xe0));
    });

    it("one save that switches the theme and edits the customizations does both", async () => {
        const { config, themeService } = setup({
            [SETTING]: { "[Light Modern]": { "editor.background": "#fff8e0" } },
        });
        // A settings.json reload fires one event for both keys.
        await config.updateMany({
            "workbench.colorTheme": "Light Modern",
            [SETTING]: { "editor.background": "#010203" },
        });
        expect(themeService.theme.name).toBe("Light Modern");
        expect(editorBackground(themeService.theme)).toBe(packRgb(0x01, 0x02, 0x03));
    });

    it("with an unknown configured theme an edit still recolors the active one", async () => {
        const { config, themeService } = setup({ "workbench.colorTheme": "No Such Theme" });
        await config.updateValue(SETTING, { "editor.background": "#202020" });
        expect(themeService.theme.name).toBe("Dark Modern");
        expect(editorBackground(themeService.theme)).toBe(packRgb(0x20, 0x20, 0x20));
    });

    it("reports skipped entries at startup and on every edit, the theme still applies", async () => {
        const { config, themeService, warnings } = setup({ [SETTING]: { "editor.background": "red" } });
        expect(warnings).toEqual([expect.stringContaining('"editor.background" must be a hex color')]);

        await config.updateValue(SETTING, { "editor.background": "#202020", "editor.foreground": 3 });
        expect(warnings).toHaveLength(2);
        expect(warnings[1]).toContain('"editor.foreground" must be a hex color');
        expect(editorBackground(themeService.theme)).toBe(packRgb(0x20, 0x20, 0x20));
    });

    it("other settings leave the theme alone", async () => {
        const { config, applied } = setup();
        await config.updateValue("editor.fontSize", 20);
        expect(applied).toEqual([]);
    });
});
