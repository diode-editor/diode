import { describe, expect, it } from "vitest";

import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type {
    IConfigurationChangeEvent,
    IConfigurationService,
} from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import type { HostColorSchemeService } from "../../../services/themes/browser/hostColorSchemeService.ts";
import type { ColorScheme } from "../../../services/themes/common/themeConfiguration.ts";
import type { ThemeRegistry } from "../../../services/themes/common/themeRegistry.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";

import { ThemeConfigContribution } from "./themeConfigContribution.ts";

class FakeConfig {
    public values: Record<string, unknown> = {};
    private listeners: ((event: IConfigurationChangeEvent) => void)[] = [];

    public onDidChangeConfiguration(cb: (event: IConfigurationChangeEvent) => void): IDisposable {
        this.listeners.push(cb);
        return { dispose: () => {} };
    }

    // The service signature is generic, but the fake can just return the value as is.
    public get(key: string): never {
        return this.values[key] as never;
    }

    /** Sets the values and fires one change event for exactly those keys. */
    public set(values: Record<string, unknown>): void {
        Object.assign(this.values, values);
        this.emit(Object.keys(values));
    }

    public emit(affectedKeys: string[]): void {
        const event: IConfigurationChangeEvent = {
            affectedKeys,
            overrideIdentifiers: [],
            affectsConfiguration: (key) => affectedKeys.some((k) => k === key || k.startsWith(`${key}.`)),
        };
        for (const l of this.listeners) l(event);
    }
}

class FakeThemeService {
    public applied: WorkbenchTheme[] = [];
    public constructor(public activeName: string) {}
    public get theme(): WorkbenchTheme {
        return { name: this.activeName } as WorkbenchTheme;
    }
    public setTheme(theme: WorkbenchTheme): void {
        this.applied.push(theme);
        this.activeName = theme.name;
    }
}

class FakeThemeRegistry {
    public constructor(private readonly themes: Record<string, WorkbenchTheme>) {}
    public resolve(name: string): WorkbenchTheme | undefined {
        return this.themes[name];
    }
}

class FakeHostColorScheme {
    private readonly emitter = new Emitter<ColorScheme>();
    public readonly onDidChangeColorScheme = this.emitter.event;
    public constructor(public colorScheme: ColorScheme | undefined) {}
    public flip(scheme: ColorScheme): void {
        this.colorScheme = scheme;
        this.emitter.fire(scheme);
    }
}

const theme = (name: string): WorkbenchTheme => ({ name }) as WorkbenchTheme;
const THEMES = {
    "Dark Modern": theme("Dark Modern"),
    "Light Modern": theme("Light Modern"),
    Mocha: theme("Mocha"),
    Latte: theme("Latte"),
};

function setup(options: {
    active: string;
    known?: Record<string, WorkbenchTheme>;
    hostScheme?: ColorScheme;
    values?: Record<string, unknown>;
}): { config: FakeConfig; themeService: FakeThemeService; host: FakeHostColorScheme } {
    const config = new FakeConfig();
    config.values = { ...options.values };
    const themeService = new FakeThemeService(options.active);
    const registry = new FakeThemeRegistry(options.known ?? THEMES);
    const host = new FakeHostColorScheme(options.hostScheme);
    new ThemeConfigContribution(
        config as unknown as IConfigurationService,
        themeService as unknown as ThemeService,
        registry as unknown as ThemeRegistry,
        host as unknown as HostColorSchemeService,
    );
    return { config, themeService, host };
}

const PAIR = {
    "workbench.colorTheme": "Dark Modern",
    "workbench.preferredDarkColorTheme": "Mocha",
    "workbench.preferredLightColorTheme": "Latte",
};

describe("ThemeConfigContribution", () => {
    it("applies the new theme when workbench.colorTheme changes", () => {
        const { config, themeService } = setup({ active: "Light Modern" });
        config.set({ "workbench.colorTheme": "Dark Modern" });
        expect(themeService.applied).toEqual([THEMES["Dark Modern"]]);
    });

    it("ignores events that do not affect the theme keys", () => {
        const { config, themeService } = setup({ active: "Light Modern" });
        config.values["workbench.colorTheme"] = "Dark Modern";
        config.emit(["editor.fontSize"]);
        expect(themeService.applied).toEqual([]);
    });

    it("does nothing when the key is missing", () => {
        const { config, themeService } = setup({ active: "Light Modern" });
        config.emit(["workbench.colorTheme"]);
        expect(themeService.applied).toEqual([]);
    });

    it("does not repaint when the theme is already active (guard by name)", () => {
        const { config, themeService } = setup({ active: "Light Modern" });
        config.set({ "workbench.colorTheme": "Light Modern" });
        expect(themeService.applied).toEqual([]);
    });

    it("ignores an unknown theme name", () => {
        const { config, themeService } = setup({ active: "Light Modern" });
        config.set({ "workbench.colorTheme": "Nonexistent" });
        expect(themeService.applied).toEqual([]);
    });

    it("turning detection on switches to the preferred theme of the host scheme", () => {
        const { config, themeService } = setup({ active: "Dark Modern", hostScheme: "light", values: PAIR });
        config.set({ "window.autoDetectColorScheme": true });
        expect(themeService.applied).toEqual([THEMES.Latte]);

        config.set({ "window.autoDetectColorScheme": false });
        expect(themeService.applied).toEqual([THEMES.Latte, THEMES["Dark Modern"]]);
    });

    it("a scheme flip switches between the preferred pair", () => {
        const { themeService, host } = setup({
            active: "Mocha",
            hostScheme: "dark",
            values: { ...PAIR, "window.autoDetectColorScheme": true },
        });
        host.flip("light");
        expect(themeService.applied).toEqual([THEMES.Latte]);
        host.flip("dark");
        expect(themeService.applied).toEqual([THEMES.Latte, THEMES.Mocha]);
    });

    it("a scheme flip with detection off keeps workbench.colorTheme", () => {
        const { themeService, host } = setup({ active: "Dark Modern", hostScheme: "dark", values: PAIR });
        host.flip("light");
        expect(themeService.applied).toEqual([]);
    });

    it("editing the preferred key of the current scheme applies it; the other scheme's key waits", () => {
        const { config, themeService } = setup({
            active: "Mocha",
            hostScheme: "dark",
            values: { ...PAIR, "window.autoDetectColorScheme": true },
        });
        config.set({ "workbench.preferredLightColorTheme": "Light Modern" });
        expect(themeService.applied).toEqual([]);
        config.set({ "workbench.preferredDarkColorTheme": "Dark Modern" });
        expect(themeService.applied).toEqual([THEMES["Dark Modern"]]);
    });

    it("an unknown host scheme with detection on falls back to workbench.colorTheme", () => {
        const { config, themeService } = setup({ active: "Mocha", values: PAIR });
        config.set({ "window.autoDetectColorScheme": true });
        expect(themeService.applied).toEqual([THEMES["Dark Modern"]]);
    });
});
