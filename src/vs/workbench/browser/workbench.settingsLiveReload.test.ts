import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type {
    IConfigurationChangeEvent,
    IConfigurationService,
} from "../../platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../platform/configuration/common/nullConfigurationService.ts";
import {
    type ConfigurationService,
    createConfigurationChangeEvent,
    loadConfiguration,
} from "../../platform/configuration/node/configurationService.ts";
import { resolveUserDataPaths } from "../../platform/environment/node/userDataPaths.ts";
import { ThemeServiceDIToken } from "../services/themes/common/themeTokens.ts";

/** IConfigurationService with a live emitter and a mutable value map (for edge cases). */
class EmittingConfig implements IConfigurationService {
    public readonly values: Record<string, unknown> = {};
    private readonly listeners: ((e: IConfigurationChangeEvent) => void)[] = [];

    public get<T>(key: string, defaultValue?: T): T | undefined {
        return key in this.values ? (this.values[key] as T) : defaultValue;
    }
    public getValue(): unknown {
        return this.values;
    }
    public inspect<T>(): { default: T | undefined; user: T | undefined; profile: T | undefined; value: T | undefined } {
        return NULL_CONFIGURATION_SERVICE.inspect<T>("");
    }
    public onDidChangeConfiguration(listener: (e: IConfigurationChangeEvent) => void): { dispose: () => void } {
        this.listeners.push(listener);
        return { dispose: () => {} };
    }
    public emit(keys: string[]): void {
        const event = createConfigurationChangeEvent(keys);
        for (const listener of this.listeners) listener(event);
    }
}

/**
 * Live-apply настроек через полный app-харнесс: правим settings.json, дёргаем
 * reload() у реального ConfigurationService и убеждаемся, что UI перестроился
 * без рестарта. Харнесс сидит на теме `Dark+` (darkPlus) — стартовые значения
 * подобраны под это.
 */
describe("Workbench — live settings apply", () => {
    let ws: ITempWorkspace;
    let cfgWs: ITempWorkspace;
    let h: IAppHarness;
    let settingsFile: string;
    let cfg: ConfigurationService;

    async function boot(initialSettings: string, harnessOpts: Parameters<typeof createAppTestHarness>[0] = {}) {
        cfgWs = createTempWorkspace({ prefix: "diode-live-cfg-" });
        const p = resolveUserDataPaths({ homedir: "/never", userDataDir: cfgWs.dir });
        settingsFile = p.settingsFile;
        writeSettings(initialSettings);
        cfg = await loadConfiguration(p);
        h = createAppTestHarness({ ...harnessOpts, configurationService: cfg });
    }

    function writeSettings(content: string): void {
        fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
        fs.writeFileSync(settingsFile, content, "utf-8");
    }

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-live-ws-", files: { "a.ts": "const x = 1;" } });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
        cfgWs.dispose();
    });

    it("repaints when workbench.colorTheme changes on disk", async () => {
        await boot(`{ "workbench.colorTheme": "Dark+" }`, { workspaceFolder: ws.dir });
        const themeService = h.container.get(ThemeServiceDIToken);
        expect(themeService.theme.name).toBe("Dark+");

        writeSettings(`{ "workbench.colorTheme": "Monokai" }`);
        await cfg.reload();

        expect(themeService.theme.name).toBe("Monokai");
    });

    it("skips the repaint when the theme name is unchanged (guard)", async () => {
        // Harness seeds the ThemeService with darkPlus ("Dark+"); the config starts
        // with no user colorTheme. Writing "Dark+" DOES put the key in the diff (the
        // config default is "Dark Modern"), so the handler runs — but the resolved
        // name equals the already-active theme, so the guard must skip re-applying.
        await boot(`{}`, { workspaceFolder: ws.dir });
        const themeService = h.container.get(ThemeServiceDIToken);
        const before = themeService.theme;
        expect(before.name).toBe("Dark+");

        writeSettings(`{ "workbench.colorTheme": "Dark+" }`);
        await cfg.reload();

        // Same name → no fresh WorkbenchTheme instance applied (identity preserved).
        expect(themeService.theme).toBe(before);
    });

    it("ignores an unknown theme name", async () => {
        await boot(`{ "workbench.colorTheme": "Dark+" }`, { workspaceFolder: ws.dir });
        const themeService = h.container.get(ThemeServiceDIToken);

        writeSettings(`{ "workbench.colorTheme": "No Such Theme" }`);
        await cfg.reload();

        // Unknown label → registry.resolve returns undefined → theme left as-is.
        expect(themeService.theme.name).toBe("Dark+");
    });

    it("applies editor.tabSize to the open editor when settings change", async () => {
        await boot(`{ "editor.tabSize": 2, "editor.insertSpaces": true }`, {
            workspaceFolder: ws.dir,
            openFile: ws.path("a.ts"),
            focusEditor: true,
        });
        expect(h.activeEditor().viewState.tabSize).toBe(2);

        writeSettings(`{ "editor.tabSize": 8, "editor.insertSpaces": false }`);
        await cfg.reload();

        expect(h.activeEditor().viewState.tabSize).toBe(8);
        expect(h.activeEditor().viewState.insertSpaces).toBe(false);
    });

    it("is a no-op when workbench.colorTheme is unset in the changed config", () => {
        // Edge: the colorTheme key is reported as affected but no value is present
        // (unusual — defaults normally supply one). The handler must bail out safely.
        const emitting = new EmittingConfig();
        h = createAppTestHarness({ workspaceFolder: ws.dir, configurationService: emitting });
        cfgWs = createTempWorkspace({ prefix: "diode-live-noop-" }); // satisfy afterEach cleanup
        const themeService = h.container.get(ThemeServiceDIToken);
        const before = themeService.theme;

        emitting.emit(["workbench.colorTheme"]);

        expect(themeService.theme).toBe(before);
    });
});
