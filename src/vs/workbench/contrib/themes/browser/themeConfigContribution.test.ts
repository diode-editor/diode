import { describe, expect, it } from "vitest";

import type { IDisposable } from "@tuidom/all/common/disposable";
import type {
    IConfigurationChangeEvent,
    IConfigurationService,
} from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import type { ThemeRegistry } from "../../../services/themes/common/themeRegistry.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";

import { ThemeConfigContribution } from "./themeConfigContribution.ts";

class FakeConfig {
    public colorTheme: string | undefined;
    private listeners: ((event: IConfigurationChangeEvent) => void)[] = [];

    public onDidChangeConfiguration(cb: (event: IConfigurationChangeEvent) => void): IDisposable {
        this.listeners.push(cb);
        return { dispose: () => {} };
    }

    public get<T>(key: string): T | undefined {
        return key === "workbench.colorTheme" ? (this.colorTheme as T | undefined) : undefined;
    }

    /** Эмитит событие смены конфига с указанными затронутыми ключами. */
    public emit(affectedKeys: string[]): void {
        const event: IConfigurationChangeEvent = {
            affectedKeys,
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

function setup(options: { active: string; known?: Record<string, WorkbenchTheme> }): {
    config: FakeConfig;
    themeService: FakeThemeService;
} {
    const config = new FakeConfig();
    const themeService = new FakeThemeService(options.active);
    const registry = new FakeThemeRegistry(options.known ?? {});
    new ThemeConfigContribution(
        config as unknown as IConfigurationService,
        themeService as unknown as ThemeService,
        registry as unknown as ThemeRegistry,
    );
    return { config, themeService };
}

describe("ThemeConfigContribution", () => {
    it("применяет новую тему при смене workbench.colorTheme", () => {
        const dark = { name: "Dark" } as WorkbenchTheme;
        const { config, themeService } = setup({ active: "Light", known: { Dark: dark } });
        config.colorTheme = "Dark";

        config.emit(["workbench.colorTheme"]);

        expect(themeService.applied).toEqual([dark]);
    });

    it("игнорирует события, не затрагивающие workbench.colorTheme", () => {
        const { config, themeService } = setup({
            active: "Light",
            known: { Dark: { name: "Dark" } as WorkbenchTheme },
        });
        config.colorTheme = "Dark";

        config.emit(["editor.fontSize"]);

        expect(themeService.applied).toEqual([]);
    });

    it("ничего не делает, если ключ отсутствует", () => {
        const { config, themeService } = setup({ active: "Light" });
        config.colorTheme = undefined;

        config.emit(["workbench.colorTheme"]);

        expect(themeService.applied).toEqual([]);
    });

    it("не перекрашивает, если тема уже активна (guard по имени)", () => {
        const { config, themeService } = setup({
            active: "Light",
            known: { Light: { name: "Light" } as WorkbenchTheme },
        });
        config.colorTheme = "Light";

        config.emit(["workbench.colorTheme"]);

        expect(themeService.applied).toEqual([]);
    });

    it("игнорирует неизвестное имя темы", () => {
        const { config, themeService } = setup({ active: "Light", known: {} });
        config.colorTheme = "Nonexistent";

        config.emit(["workbench.colorTheme"]);

        expect(themeService.applied).toEqual([]);
    });
});
