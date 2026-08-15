import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IDisposable } from "@tuidom/core/common/disposable";
import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import type { IUserDataPaths } from "../../environment/node/userDataPaths.ts";
import { resolveUserDataPaths } from "../../environment/node/userDataPaths.ts";
import type { IFileWatcher } from "../../files/common/iFileWatcher.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { ConfigurationModel } from "../common/configurationModel.ts";
import { ConfigurationRegistry } from "../common/configurationRegistry.ts";
import type { IConfigurationChangeEvent } from "../common/iConfigurationService.ts";

import {
    ConfigurationService,
    createConfigurationChangeEvent,
    diffConfigurationKeys,
    loadConfiguration,
} from "./configurationService.ts";

/** Fake watcher: records the onChange callback per path so tests fire it by hand. */
class FakeFileWatcher implements IFileWatcher {
    private handlers = new Map<string, () => void>();

    public watchFile(filePath: string, onChange: () => void): IDisposable {
        this.handlers.set(filePath, onChange);
        return { dispose: () => this.handlers.delete(filePath) };
    }

    public fire(filePath: string): void {
        this.handlers.get(filePath)?.();
    }

    public isWatching(filePath: string): boolean {
        return this.handlers.has(filePath);
    }

    public get watchedCount(): number {
        return this.handlers.size;
    }
}

/**
 * Тестовый реестр дефолтов — минимальный editor-узел, который ассертят тесты
 * слоёв. Реальные узлы приложения (`CONFIGURATION_CONTRIBUTIONS`) живут выше по
 * стеку (Workbench) и сюда не тянутся.
 */
const TEST_REGISTRY = new ConfigurationRegistry([
    {
        id: "editor",
        properties: {
            "editor.tabSize": { type: "number", default: 4 },
            "editor.insertSpaces": { type: "boolean", default: true },
            "editor.cursorSurroundingLines": { type: "number", default: 3 },
        },
    },
]);

/** `loadConfiguration` с тестовым defaults-реестром (как production с app-узлами). */
function loadCfg(paths: IUserDataPaths, logger?: ILogger, fileWatcher?: IFileWatcher) {
    return loadConfiguration(paths, logger, fileWatcher, TEST_REGISTRY);
}

describe("loadConfiguration", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-cfg-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function paths(profile?: string) {
        return resolveUserDataPaths({ homedir: "/never", userDataDir: ws.dir, profile });
    }

    function writeSettings(file: string, content: string): void {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }

    it("returns defaults when no settings files exist", async () => {
        const cfg = await loadCfg(paths());
        expect(cfg.get<number>("editor.tabSize")).toBe(4);
        expect(cfg.get<boolean>("editor.insertSpaces")).toBe(true);
    });

    it("loads user settings.json (default profile)", async () => {
        const p = paths();
        writeSettings(p.settingsFile, `{ "editor.tabSize": 2 }`);
        const cfg = await loadCfg(p);
        expect(cfg.get<number>("editor.tabSize")).toBe(2);
        expect(cfg.get<boolean>("editor.insertSpaces")).toBe(true); // from defaults
    });

    it("supports JSONC: comments and trailing commas", async () => {
        const p = paths();
        writeSettings(
            p.settingsFile,
            `{
                // tab size
                "editor.tabSize": 8,
                "editor.insertSpaces": false, // trailing
            }`,
        );
        const cfg = await loadCfg(p);
        expect(cfg.get<number>("editor.tabSize")).toBe(8);
        expect(cfg.get<boolean>("editor.insertSpaces")).toBe(false);
    });

    it("falls back to defaults on broken JSONC", async () => {
        const p = paths();
        writeSettings(p.settingsFile, `{ this is not json`);
        const logger = {
            trace: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            isEnabled: () => true,
        };
        const cfg = await loadCfg(p, logger);
        expect(cfg.get<number>("editor.tabSize")).toBe(4);
        expect(logger.error).toHaveBeenCalled();
    });

    it("named profile overrides user settings", async () => {
        const defaultPaths = paths();
        writeSettings(defaultPaths.settingsFile, `{ "editor.tabSize": 2 }`);

        const compactPaths = paths("compact");
        writeSettings(compactPaths.settingsFile, `{ "editor.tabSize": 8 }`);

        const cfg = await loadCfg(compactPaths);
        expect(cfg.get<number>("editor.tabSize")).toBe(8);
        // user-слой ещё применяется поверх defaults
        expect(cfg.get<boolean>("editor.insertSpaces")).toBe(true);
    });

    it("inspect reports per-layer values", async () => {
        const defaultPaths = paths();
        writeSettings(defaultPaths.settingsFile, `{ "editor.tabSize": 2 }`);

        const compactPaths = paths("compact");
        writeSettings(compactPaths.settingsFile, `{ "editor.tabSize": 8 }`);

        const cfg = await loadCfg(compactPaths);
        const ins = cfg.inspect<number>("editor.tabSize");
        expect(ins.default).toBe(4);
        expect(ins.user).toBe(2);
        expect(ins.profile).toBe(8);
        expect(ins.value).toBe(8);
    });

    it("named profile with no file uses user settings", async () => {
        const defaultPaths = paths();
        writeSettings(defaultPaths.settingsFile, `{ "editor.tabSize": 2 }`);

        const cfg = await loadCfg(paths("compact"));
        expect(cfg.get<number>("editor.tabSize")).toBe(2);
    });

    it("get returns provided default for unknown keys", async () => {
        const cfg = await loadCfg(paths());
        expect(cfg.get<string>("unknown.key", "fallback")).toBe("fallback");
    });

    it("getValue returns nested subtree", async () => {
        const cfg = await loadCfg(paths());
        expect(cfg.getValue("editor")).toEqual({ tabSize: 4, insertSpaces: true, cursorSurroundingLines: 3 });
    });

    it("onDidChangeConfiguration subscription can be disposed (listener no longer fires)", async () => {
        const p = paths();
        const cfg = await loadCfg(p);
        let calls = 0;
        const sub = cfg.onDidChangeConfiguration(() => {
            calls++;
        });
        sub.dispose();
        // After dispose the listener must not be invoked on subsequent changes.
        writeSettings(path.join(p.userDir, "settings.json"), `{ "editor.tabSize": 2 }`);
        await cfg.reload();
        expect(calls).toBe(0);
        expect(cfg.get<number>("editor.tabSize")).toBe(2);
    });

    it("logs and falls back to defaults when a settings file can't be read", async () => {
        const p = paths();
        // Make settings.json a directory → readFile throws EISDIR (not ENOENT),
        // exercising the error branch rather than the missing-file branch.
        fs.mkdirSync(p.settingsFile, { recursive: true });
        const logger = {
            trace: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            isEnabled: () => true,
        };
        const cfg = await loadCfg(p, logger);
        expect(cfg.get<number>("editor.tabSize")).toBe(4);
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining("Failed to read settings file"),
            expect.anything(),
        );
    });
});

describe("ConfigurationService.updateUserValue", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-cfg-write-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function paths(profile?: string) {
        return resolveUserDataPaths({ homedir: "/never", userDataDir: ws.dir, profile });
    }

    it("writes the key to settings.json when the file did not exist", async () => {
        const p = paths();
        const cfg = await loadCfg(p);
        await cfg.updateUserValue("workbench.colorTheme", "Monokai");

        const written = fs.readFileSync(p.settingsFile, "utf-8");
        expect(JSON.parse(written)).toEqual({ "workbench.colorTheme": "Monokai" });
        // In-memory model reflects the write immediately (no reload needed).
        expect(cfg.get<string>("workbench.colorTheme")).toBe("Monokai");
    });

    it("preserves existing keys and comments in settings.json", async () => {
        const p = paths();
        fs.mkdirSync(path.dirname(p.settingsFile), { recursive: true });
        fs.writeFileSync(
            p.settingsFile,
            `{
    // keep me
    "editor.tabSize": 2
}
`,
        );
        const cfg = await loadCfg(p);
        await cfg.updateUserValue("workbench.colorTheme", "Light Modern");

        const written = fs.readFileSync(p.settingsFile, "utf-8");
        expect(written).toContain("// keep me");
        expect(written).toContain(`"editor.tabSize": 2`);
        expect(written).toContain(`"workbench.colorTheme": "Light Modern"`);
        expect(cfg.get<number>("editor.tabSize")).toBe(2);
        expect(cfg.get<string>("workbench.colorTheme")).toBe("Light Modern");
    });

    it("writes to the profile settings file for a named profile", async () => {
        const p = paths("compact");
        const cfg = await loadCfg(p);
        await cfg.updateUserValue("workbench.colorTheme", "Dark+");

        expect(fs.existsSync(p.settingsFile)).toBe(true);
        expect(JSON.parse(fs.readFileSync(p.settingsFile, "utf-8"))).toEqual({ "workbench.colorTheme": "Dark+" });
        expect(cfg.get<string>("workbench.colorTheme")).toBe("Dark+");
    });

    it("is a no-op when no write target is configured", async () => {
        // Constructed without `writeTargetPath` (e.g. read-only context) → the write
        // is silently skipped and the in-memory value stays unchanged.
        const cfg = new ConfigurationService({
            defaultsLayer: ConfigurationModel.EMPTY,
            userLayer: ConfigurationModel.EMPTY,
            profileLayer: ConfigurationModel.EMPTY,
        });
        await expect(cfg.updateUserValue("workbench.colorTheme", "Monokai")).resolves.toBeUndefined();
        expect(cfg.get<string>("workbench.colorTheme")).toBeUndefined();
    });

    it("rethrows read errors that are not 'file not found'", async () => {
        const p = paths();
        const cfg = await loadCfg(p);
        // Make the settings path a directory so reading it fails with EISDIR (not ENOENT).
        fs.mkdirSync(p.settingsFile, { recursive: true });
        await expect(cfg.updateUserValue("workbench.colorTheme", "Monokai")).rejects.toThrow();
    });

    it("updateUserValue emits onDidChangeConfiguration with the changed key", async () => {
        const cfg = await loadCfg(paths());
        const events: IConfigurationChangeEvent[] = [];
        cfg.onDidChangeConfiguration((e) => events.push(e));

        await cfg.updateUserValue("workbench.colorTheme", "Monokai");

        expect(events).toHaveLength(1);
        expect(events[0].affectedKeys).toContain("workbench.colorTheme");
        expect(events[0].affectsConfiguration("workbench.colorTheme")).toBe(true);
        expect(events[0].affectsConfiguration("workbench")).toBe(true);
    });

    it("updateUserValue does not emit when the value is unchanged (empty diff)", async () => {
        const p = paths();
        fs.mkdirSync(path.dirname(p.settingsFile), { recursive: true });
        fs.writeFileSync(p.settingsFile, `{ "editor.tabSize": 4 }`); // same as default
        const cfg = await loadCfg(p);
        const events: IConfigurationChangeEvent[] = [];
        cfg.onDidChangeConfiguration((e) => events.push(e));

        // Write the same value that is already effective — merged doesn't change.
        await cfg.updateUserValue("editor.tabSize", 4);

        expect(events).toHaveLength(0);
    });
});

describe("ConfigurationService — live reload", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-cfg-live-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function paths(profile?: string) {
        return resolveUserDataPaths({ homedir: "/never", userDataDir: ws.dir, profile });
    }

    function userSettingsPath(profile?: string): string {
        return path.join(paths(profile).userDir, "settings.json");
    }

    function writeSettings(file: string, content: string): void {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }

    it("watches the user settings.json for the default profile", async () => {
        const watcher = new FakeFileWatcher();
        await loadCfg(paths(), undefined, watcher);
        expect(watcher.isWatching(userSettingsPath())).toBe(true);
        expect(watcher.watchedCount).toBe(1);
    });

    it("watches both user and profile settings for a named profile", async () => {
        const watcher = new FakeFileWatcher();
        const p = paths("compact");
        await loadCfg(p, undefined, watcher);
        expect(watcher.isWatching(userSettingsPath("compact"))).toBe(true);
        expect(watcher.isWatching(p.settingsFile)).toBe(true);
        expect(watcher.watchedCount).toBe(2);
    });

    it("does not set up watching when no watcher is provided", async () => {
        // loadConfiguration without a watcher must not throw and reload still works manually.
        const cfg = await loadCfg(paths());
        writeSettings(userSettingsPath(), `{ "editor.tabSize": 2 }`);
        await cfg.reload();
        expect(cfg.get<number>("editor.tabSize")).toBe(2);
    });

    it("reload picks up an external edit and emits the changed keys", async () => {
        const p = paths();
        writeSettings(p.settingsFile, `{ "editor.tabSize": 2 }`);
        const cfg = await loadCfg(p);
        const events: IConfigurationChangeEvent[] = [];
        cfg.onDidChangeConfiguration((e) => events.push(e));

        writeSettings(p.settingsFile, `{ "editor.tabSize": 8, "editor.insertSpaces": false }`);
        await cfg.reload();

        expect(cfg.get<number>("editor.tabSize")).toBe(8);
        expect(cfg.get<boolean>("editor.insertSpaces")).toBe(false);
        expect(events).toHaveLength(1);
        expect(new Set(events[0].affectedKeys)).toEqual(new Set(["editor.tabSize", "editor.insertSpaces"]));
    });

    it("reload emits nothing when the file content is effectively unchanged", async () => {
        const p = paths();
        writeSettings(p.settingsFile, `{ "editor.tabSize": 2 }`);
        const cfg = await loadCfg(p);
        const events: IConfigurationChangeEvent[] = [];
        cfg.onDidChangeConfiguration((e) => events.push(e));

        // Re-write identical content (different formatting, same values).
        writeSettings(p.settingsFile, `{\n  "editor.tabSize": 2,\n}`);
        await cfg.reload();

        expect(events).toHaveLength(0);
    });

    it("reload reports a key reverting to its default value", async () => {
        const p = paths();
        writeSettings(p.settingsFile, `{ "editor.tabSize": 2 }`);
        const cfg = await loadCfg(p);
        const events: IConfigurationChangeEvent[] = [];
        cfg.onDidChangeConfiguration((e) => events.push(e));

        // Remove the override → effective value falls back to default (4).
        writeSettings(p.settingsFile, `{}`);
        await cfg.reload();

        expect(cfg.get<number>("editor.tabSize")).toBe(4);
        expect(events).toHaveLength(1);
        expect(events[0].affectedKeys).toContain("editor.tabSize");
    });

    it("reload of a named profile picks up a profile-layer change", async () => {
        const p = paths("compact");
        writeSettings(p.settingsFile, `{ "editor.tabSize": 8 }`);
        const cfg = await loadCfg(p);
        const events: IConfigurationChangeEvent[] = [];
        cfg.onDidChangeConfiguration((e) => events.push(e));

        writeSettings(p.settingsFile, `{ "editor.tabSize": 3 }`);
        await cfg.reload();

        expect(cfg.get<number>("editor.tabSize")).toBe(3);
        expect(events).toHaveLength(1);
    });

    it("reload treats a broken/removed settings file as an empty layer", async () => {
        const p = paths();
        writeSettings(p.settingsFile, `{ "editor.tabSize": 2 }`);
        const cfg = await loadCfg(p);

        fs.rmSync(p.settingsFile);
        await cfg.reload();

        // Missing file → user layer empty → back to defaults, no crash.
        expect(cfg.get<number>("editor.tabSize")).toBe(4);
    });

    it("firing the watcher triggers a reload and emits the event", async () => {
        const watcher = new FakeFileWatcher();
        const p = paths();
        const cfg = await loadCfg(p, undefined, watcher);
        const events: IConfigurationChangeEvent[] = [];
        cfg.onDidChangeConfiguration((e) => events.push(e));

        writeSettings(p.settingsFile, `{ "editor.tabSize": 6 }`);
        watcher.fire(userSettingsPath());
        await vi.waitFor(() => {
            expect(events).toHaveLength(1);
        });

        expect(cfg.get<number>("editor.tabSize")).toBe(6);
        expect(events[0].affectsConfiguration("editor")).toBe(true);
    });

    it("disposing the service stops the file watch", async () => {
        const watcher = new FakeFileWatcher();
        const cfg = await loadCfg(paths(), undefined, watcher);
        expect(watcher.isWatching(userSettingsPath())).toBe(true);
        cfg.dispose();
        expect(watcher.isWatching(userSettingsPath())).toBe(false);
    });

    it("with a watcher but no paths: watches nothing and reload is a no-op", async () => {
        // Directly constructed (no loadConfiguration) → no settings paths. The watcher
        // is provided but there is nothing to watch, and reload() must not emit.
        const watcher = new FakeFileWatcher();
        const cfg = new ConfigurationService({
            defaultsLayer: ConfigurationModel.EMPTY,
            userLayer: ConfigurationModel.EMPTY,
            profileLayer: ConfigurationModel.EMPTY,
            fileWatcher: watcher,
        });
        const events: IConfigurationChangeEvent[] = [];
        cfg.onDidChangeConfiguration((e) => events.push(e));

        expect(watcher.watchedCount).toBe(0);
        await expect(cfg.reload()).resolves.toBeUndefined();
        expect(events).toHaveLength(0);
    });

    it("disposing a subscription twice is safe", async () => {
        const cfg = await loadCfg(paths());
        const sub = cfg.onDidChangeConfiguration(() => {
            /* noop */
        });
        sub.dispose();
        expect(() => {
            sub.dispose();
        }).not.toThrow();
    });
});

describe("diffConfigurationKeys", () => {
    it("reports added, removed and changed leaf keys (including arrays/objects)", () => {
        const prev = ConfigurationModel.fromRaw({
            "editor.tabSize": 2,
            "editor.rulers": [80],
            "a.b": 1,
        });
        const next = ConfigurationModel.fromRaw({
            "editor.tabSize": 4, // changed
            "editor.rulers": [80, 120], // changed (array)
            "c.d": true, // added
            // a.b removed
        });
        expect(new Set(diffConfigurationKeys(prev, next))).toEqual(
            new Set(["editor.tabSize", "editor.rulers", "c.d", "a.b"]),
        );
    });

    it("returns an empty list for structurally equal models", () => {
        const a = ConfigurationModel.fromRaw({ "x.y": [1, 2], "x.z": "s" });
        const b = ConfigurationModel.fromRaw({ "x.y": [1, 2], "x.z": "s" });
        expect(diffConfigurationKeys(a, b)).toEqual([]);
    });
});

describe("createConfigurationChangeEvent", () => {
    it("affectsConfiguration matches exact key, ancestor and descendant", () => {
        const event = createConfigurationChangeEvent(["editor.tabSize"]);
        expect(event.affectsConfiguration("editor.tabSize")).toBe(true); // exact
        expect(event.affectsConfiguration("editor")).toBe(true); // ancestor
        expect(event.affectsConfiguration("editor.tabSize.deep")).toBe(true); // descendant
        expect(event.affectsConfiguration("workbench")).toBe(false); // unrelated
        expect(event.affectsConfiguration("editorX")).toBe(false); // prefix but not a segment boundary
    });
});
