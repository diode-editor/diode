import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../TestUtils/disposableLeaks.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { IUserDataPaths } from "../../environment/node/userDataPaths.ts";
import { resolveUserDataPaths } from "../../environment/node/userDataPaths.ts";
import type { IFileWatcher } from "../../files/common/iFileWatcher.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { ConfigurationModel } from "../common/configurationModel.ts";
import { ConfigurationRegistry } from "../common/configurationRegistry.ts";
import type { IConfigurationChangeEvent } from "../common/iConfigurationService.ts";

import { ConfigurationService, loadConfiguration } from "./configurationService.ts";

const disposables = ensureNoDisposablesAreLeakedInTestSuite();

function fakeLogger(): ILogger {
    return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), isEnabled: () => true };
}

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

const TEST_REGISTRY = new ConfigurationRegistry([
    {
        id: "editor",
        properties: {
            "editor.tabSize": { scope: "language-overridable", type: "number", default: 4 },
            "editor.insertSpaces": { scope: "language-overridable", type: "boolean", default: true },
            "editor.cursorSurroundingLines": { scope: "language-overridable", type: "number", default: 3 },
        },
    },
    {
        id: "update",
        properties: {
            "update.mode": { scope: "application", type: "string", default: "default" },
        },
    },
]);

function loadCfg(paths: IUserDataPaths, logger?: ILogger, fileWatcher?: IFileWatcher) {
    return loadConfiguration(paths, logger, fileWatcher, TEST_REGISTRY).then((cfg) => disposables.add(cfg));
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
        expect(cfg.get<boolean>("editor.insertSpaces")).toBe(true);
    });

    it("значение вне схемы реестра — дефолт схемы (и после live-reload тоже)", async () => {
        const p = paths();
        writeSettings(p.settingsFile, `{ "editor.tabSize": "four", "editor.insertSpaces": false }`);
        const cfg = await loadCfg(p);
        expect(cfg.get("editor.tabSize")).toBe(4);
        expect(cfg.get("editor.insertSpaces")).toBe(false);
        expect(cfg.inspect("editor.tabSize").user).toBe("four");

        writeSettings(p.settingsFile, `{ "editor.tabSize": null }`);
        await cfg.reload();
        expect(cfg.get("editor.tabSize")).toBe(4);
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

    it("named profile settings replace user settings (not inherit them)", async () => {
        const defaultPaths = paths();
        writeSettings(defaultPaths.settingsFile, `{ "editor.tabSize": 2, "editor.insertSpaces": false }`);

        const compactPaths = paths("compact");
        writeSettings(compactPaths.settingsFile, `{ "editor.tabSize": 8 }`);

        const cfg = await loadCfg(compactPaths);
        expect(cfg.get<number>("editor.tabSize")).toBe(8);
        // Не-application ключ Default'а в именованный профиль НЕ приходит — дефолт реестра.
        expect(cfg.get<boolean>("editor.insertSpaces")).toBe(true);
    });

    describe("именованный профиль и application-ключи (семантика эталона)", () => {
        it("application-ключ Default'а действует в именованном профиле; незарегистрированный — нет", async () => {
            writeSettings(paths().settingsFile, `{ "update.mode": "none", "git.enabled": false, "editor.tabSize": 2 }`);
            const cfg = await loadCfg(paths("compact"));
            expect(cfg.get("update.mode")).toBe("none");
            expect(cfg.get("git.enabled")).toBeUndefined();
            expect(cfg.get("editor.tabSize")).toBe(4);
            expect(cfg.inspect("update.mode").user).toBe("none");
            expect(cfg.inspect("editor.tabSize").user).toBeUndefined();
            expect(cfg.getConfigurationData().user).toEqual({ update: { mode: "none" } });
        });

        it("application-ключ в файле профиля не действует и назван warn'ом", async () => {
            const p = paths("compact");
            writeSettings(paths().settingsFile, `{ "update.mode": "none" }`);
            writeSettings(p.settingsFile, `{ "update.mode": "manual", "editor.tabSize": 8 }`);
            const logger = fakeLogger();
            const cfg = await loadCfg(p, logger);
            expect(cfg.get("update.mode")).toBe("none");
            expect(cfg.get("editor.tabSize")).toBe(8);
            expect(cfg.inspect("update.mode").profile).toBeUndefined();
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("update.mode"));
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(p.settingsFile));
        });

        it("warn про application-ключ — один раз на набор: запись в файл профиля не повторяет его, возврат ключа — повторяет", async () => {
            const p = paths("compact");
            writeSettings(p.settingsFile, `{ "update.mode": "manual" }`);
            const logger = fakeLogger();
            const cfg = await loadCfg(p, logger);
            expect(logger.warn).toHaveBeenCalledTimes(1);
            // Запись в файл профиля перечитывает его слой — тот же набор, без повтора.
            await cfg.updateValue("editor.tabSize", 2);
            expect(logger.warn).toHaveBeenCalledTimes(1);
            // Ключ ушёл — тишина; вернулся — названо снова.
            writeSettings(p.settingsFile, `{ "editor.tabSize": 2 }`);
            await cfg.reload();
            expect(logger.warn).toHaveBeenCalledTimes(1);
            writeSettings(p.settingsFile, `{ "editor.tabSize": 2, "update.mode": "none" }`);
            await cfg.reload();
            expect(logger.warn).toHaveBeenCalledTimes(2);
            expect(logger.warn).toHaveBeenLastCalledWith(expect.stringContaining("update.mode"));
        });

        it("в файле профиля только его ключи — предупреждать не о чем", async () => {
            const p = paths("compact");
            writeSettings(p.settingsFile, `{ "editor.tabSize": 8 }`);
            const logger = fakeLogger();
            const cfg = await loadCfg(p, logger);
            expect(cfg.get("editor.tabSize")).toBe(8);
            expect(logger.warn).not.toHaveBeenCalled();
        });

        it("без логгера application-ключ в файле профиля отбрасывается молча", async () => {
            const p = paths("compact");
            writeSettings(p.settingsFile, `{ "update.mode": "manual" }`);
            const cfg = await loadCfg(p);
            expect(cfg.get("update.mode")).toBe("default");
        });

        it("profile-слой без файла профиля (сборка без profileSettingsPath) — warn не о чем", () => {
            const logger = fakeLogger();
            disposables.add(
                new ConfigurationService({
                    defaultsLayer: ConfigurationModel.EMPTY,
                    userLayer: ConfigurationModel.EMPTY,
                    profileLayer: ConfigurationModel.fromRaw({ "update.mode": "none" }),
                    scopes: TEST_REGISTRY.getConfigurationScopes(),
                    logger,
                }),
            );
            expect(logger.warn).not.toHaveBeenCalled();
        });

        it("запись application-ключа из именованного профиля идёт в User/settings.json", async () => {
            const p = paths("compact");
            const cfg = await loadCfg(p);
            const events: IConfigurationChangeEvent[] = [];
            disposables.add(cfg.onDidChangeConfiguration((e) => events.push(e)));
            await cfg.updateValue("update.mode", "manual");
            await cfg.updateValue("editor.tabSize", 2);
            expect(JSON.parse(fs.readFileSync(paths().settingsFile, "utf-8"))).toEqual({ "update.mode": "manual" });
            expect(JSON.parse(fs.readFileSync(p.settingsFile, "utf-8"))).toEqual({ "editor.tabSize": 2 });
            expect(cfg.get("update.mode")).toBe("manual");
            expect(cfg.inspect("update.mode").user).toBe("manual");
            expect(cfg.get("editor.tabSize")).toBe(2);
            expect(events.map((e) => e.affectedKeys)).toEqual([["update.mode"], ["editor.tabSize"]]);
        });

        it("reload именованного профиля подхватывает application-ключ из User/settings.json", async () => {
            const p = paths("compact");
            const cfg = await loadCfg(p);
            const events: IConfigurationChangeEvent[] = [];
            disposables.add(cfg.onDidChangeConfiguration((e) => events.push(e)));
            writeSettings(paths().settingsFile, `{ "update.mode": "none", "editor.tabSize": 2 }`);
            await cfg.reload();
            expect(cfg.get("update.mode")).toBe("none");
            expect(cfg.get("editor.tabSize")).toBe(4);
            expect(events).toHaveLength(1);
            expect(events[0].affectedKeys).toEqual(["update.mode"]);
        });

        it("у Default-профиля application-ключ пишется и читается как любой другой", async () => {
            const p = paths();
            const cfg = await loadCfg(p);
            await cfg.updateValue("update.mode", "manual");
            expect(JSON.parse(fs.readFileSync(p.settingsFile, "utf-8"))).toEqual({ "update.mode": "manual" });
            expect(cfg.inspect("update.mode").user).toBe("manual");
        });
    });

    it("getConfigurationData: дефолты реестра и пользовательский слой (profile поверх application-ключей user), как записаны", async () => {
        writeSettings(paths().settingsFile, `{ "editor.tabSize": 2, "git.enabled": false, "update.mode": "none" }`);
        const compactPaths = paths("compact");
        writeSettings(compactPaths.settingsFile, `{ "editor.tabSize": "eight" }`);

        const cfg = await loadCfg(compactPaths);

        expect(cfg.getConfigurationData()).toEqual({
            defaults: {
                editor: { tabSize: 4, insertSpaces: true, cursorSurroundingLines: 3 },
                update: { mode: "default" },
            },
            user: { editor: { tabSize: "eight" }, update: { mode: "none" } },
            workspace: {},
            workspaceFolder: {},
        });
    });

    it("секция языка из settings.json: чтение для языка и сырая форма для хоста", async () => {
        const p = paths();
        writeSettings(p.settingsFile, `{ "editor.tabSize": 2, "[go]": { "editor.tabSize": 8 } }`);

        const cfg = await loadCfg(p);

        expect(cfg.get("editor.tabSize")).toBe(2);
        expect(cfg.get("editor.tabSize", { overrideIdentifier: "go" })).toBe(8);
        expect(cfg.inspect("editor.tabSize", { overrideIdentifier: "go" }).value).toBe(8);
        expect(cfg.getConfigurationData().user).toEqual({ editor: { tabSize: 2 }, "[go]": { editor: { tabSize: 8 } } });
    });

    it("inspect reports per-layer values", async () => {
        const defaultPaths = paths();
        writeSettings(defaultPaths.settingsFile, `{ "editor.tabSize": 2 }`);

        const compactPaths = paths("compact");
        writeSettings(compactPaths.settingsFile, `{ "editor.tabSize": 8 }`);

        const cfg = await loadCfg(compactPaths);
        const ins = cfg.inspect<number>("editor.tabSize");
        expect(ins.default).toBe(4);
        // Слой user у именованного профиля — только application-ключи Default'а.
        expect(ins.user).toBeUndefined();
        expect(ins.profile).toBe(8);
        expect(ins.value).toBe(8);
    });

    it("named profile with no file: user settings of other scopes do not apply", async () => {
        const defaultPaths = paths();
        writeSettings(defaultPaths.settingsFile, `{ "editor.tabSize": 2 }`);

        const cfg = await loadCfg(paths("compact"));
        expect(cfg.get<number>("editor.tabSize")).toBe(4);
    });

    it("get returns undefined for unknown keys", async () => {
        const cfg = await loadCfg(paths());
        expect(cfg.get<string>("unknown.key")).toBeUndefined();
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
        writeSettings(path.join(p.userDir, "settings.json"), `{ "editor.tabSize": 2 }`);
        await cfg.reload();
        expect(calls).toBe(0);
        expect(cfg.get<number>("editor.tabSize")).toBe(2);
    });

    it("logs and falls back to defaults when a settings file can't be read", async () => {
        const p = paths();
        // EISDIR, а не ENOENT: ветка ошибки чтения, а не отсутствующего файла.
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

describe("ConfigurationService.updateValue", () => {
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
        await cfg.updateValue("workbench.colorTheme", "Monokai");

        const written = fs.readFileSync(p.settingsFile, "utf-8");
        expect(JSON.parse(written)).toEqual({ "workbench.colorTheme": "Monokai" });
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
        await cfg.updateValue("workbench.colorTheme", "Light Modern");

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
        await cfg.updateValue("workbench.colorTheme", "Dark+");

        expect(fs.existsSync(p.settingsFile)).toBe(true);
        expect(JSON.parse(fs.readFileSync(p.settingsFile, "utf-8"))).toEqual({ "workbench.colorTheme": "Dark+" });
        expect(cfg.get<string>("workbench.colorTheme")).toBe("Dark+");
    });

    it("is a no-op when no write target is configured", async () => {
        const cfg = disposables.add(
            new ConfigurationService({
                defaultsLayer: ConfigurationModel.EMPTY,
                userLayer: ConfigurationModel.EMPTY,
                profileLayer: ConfigurationModel.EMPTY,
            }),
        );
        await expect(cfg.updateValue("workbench.colorTheme", "Monokai")).resolves.toBeUndefined();
        expect(cfg.get<string>("workbench.colorTheme")).toBeUndefined();
    });

    it("rethrows read errors that are not 'file not found'", async () => {
        const p = paths();
        const cfg = await loadCfg(p);
        // Make the settings path a directory so reading it fails with EISDIR (not ENOENT).
        fs.mkdirSync(p.settingsFile, { recursive: true });
        await expect(cfg.updateValue("workbench.colorTheme", "Monokai")).rejects.toThrow();
    });

    it("updateValue emits onDidChangeConfiguration with the changed key", async () => {
        const cfg = await loadCfg(paths());
        const events: IConfigurationChangeEvent[] = [];
        disposables.add(cfg.onDidChangeConfiguration((e) => events.push(e)));

        await cfg.updateValue("workbench.colorTheme", "Monokai");

        expect(events).toHaveLength(1);
        expect(events[0].affectedKeys).toContain("workbench.colorTheme");
        expect(events[0].affectsConfiguration("workbench.colorTheme")).toBe(true);
        expect(events[0].affectsConfiguration("workbench")).toBe(true);
    });

    it("updateValue does not emit when the value is unchanged (empty diff)", async () => {
        const p = paths();
        fs.mkdirSync(path.dirname(p.settingsFile), { recursive: true });
        fs.writeFileSync(p.settingsFile, `{ "editor.tabSize": 4 }`); // same as default
        const cfg = await loadCfg(p);
        const events: IConfigurationChangeEvent[] = [];
        disposables.add(cfg.onDidChangeConfiguration((e) => events.push(e)));

        await cfg.updateValue("editor.tabSize", 4);

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
        disposables.add(cfg.onDidChangeConfiguration((e) => events.push(e)));

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
        disposables.add(cfg.onDidChangeConfiguration((e) => events.push(e)));

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
        disposables.add(cfg.onDidChangeConfiguration((e) => events.push(e)));

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
        disposables.add(cfg.onDidChangeConfiguration((e) => events.push(e)));

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

        expect(cfg.get<number>("editor.tabSize")).toBe(4);
    });

    it("firing the watcher triggers a reload and emits the event", async () => {
        const watcher = new FakeFileWatcher();
        const p = paths();
        const cfg = await loadCfg(p, undefined, watcher);
        const events: IConfigurationChangeEvent[] = [];
        disposables.add(cfg.onDidChangeConfiguration((e) => events.push(e)));

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
        const watcher = new FakeFileWatcher();
        const cfg = disposables.add(
            new ConfigurationService({
                defaultsLayer: ConfigurationModel.EMPTY,
                userLayer: ConfigurationModel.EMPTY,
                profileLayer: ConfigurationModel.EMPTY,
                fileWatcher: watcher,
            }),
        );
        const events: IConfigurationChangeEvent[] = [];
        disposables.add(cfg.onDidChangeConfiguration((e) => events.push(e)));

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
