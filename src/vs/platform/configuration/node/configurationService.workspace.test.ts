import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../TestUtils/disposableLeaks.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { resolveUserDataPaths } from "../../environment/node/userDataPaths.ts";
import type { IFileWatcher } from "../../files/common/iFileWatcher.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { ConfigurationModel } from "../common/configurationModel.ts";
import { ConfigurationRegistry } from "../common/configurationRegistry.ts";
import type { IConfigurationChangeEvent } from "../common/iConfigurationService.ts";

import { ConfigurationService, loadConfiguration } from "./configurationService.ts";

const disposables = ensureNoDisposablesAreLeakedInTestSuite();

/** Fake watcher: колбэк по пути, тест дёргает его руками. */
class FakeFileWatcher implements IFileWatcher {
    private readonly handlers = new Map<string, () => void>();

    public watchFile(filePath: string, onChange: () => void): IDisposable {
        this.handlers.set(filePath, onChange);
        return { dispose: () => this.handlers.delete(filePath) };
    }

    public fire(filePath: string): void {
        this.handlers.get(filePath)?.();
    }

    public watched(): string[] {
        return [...this.handlers.keys()];
    }
}

/**
 * Реестр со всеми видами скоупов: ядро (`editor.*` — language-overridable,
 * `files.exclude` — resource, `workbench.colorTheme` — window,
 * `terminal.tier` — machine, `update.mode` — application) и ключи расширения
 * (`java.home` — `machine-overridable`, в воркспейс можно; `java.secret` —
 * `machine`, нельзя).
 */
function testRegistry(): ConfigurationRegistry {
    const registry = new ConfigurationRegistry([
        {
            id: "test",
            properties: {
                "editor.tabSize": { scope: "language-overridable", type: "number", default: 4 },
                "files.exclude": { scope: "resource", type: "object", default: {} },
                "workbench.colorTheme": { scope: "window", type: "string", default: "Dark" },
                "terminal.tier": { scope: "machine", type: "string", default: "auto" },
                "update.mode": { scope: "application", type: "string", default: "default" },
            },
        },
    ]);
    registry.registerExtensionConfiguration("acme.java", {
        "java.home": { scope: "machine-overridable" },
        "java.secret": { scope: "machine" },
    });
    return registry;
}

function makeLogger(): ILogger & { warn: Mock<ILogger["warn"]>; error: Mock<ILogger["error"]> } {
    return {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn<ILogger["warn"]>(),
        error: vi.fn<ILogger["error"]>(),
        isEnabled: () => true,
    };
}

describe("ConfigurationService — слой воркспейса", () => {
    let userData: ITempWorkspace;
    let folder: ITempWorkspace;

    beforeEach(() => {
        userData = createTempWorkspace({ prefix: "diode-cfg-user-" });
        folder = createTempWorkspace({ prefix: "diode-cfg-ws-" });
    });

    afterEach(() => {
        userData.dispose();
        folder.dispose();
    });

    function paths(profile?: string) {
        return resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir, profile });
    }

    function writeUser(content: string, profile?: string): void {
        const file = paths(profile).settingsFile;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }

    async function load(
        options: { folder?: string; logger?: ILogger; watcher?: IFileWatcher; profile?: string } = {},
    ): Promise<ConfigurationService> {
        const cfg = await loadConfiguration(
            paths(options.profile),
            options.logger,
            options.watcher,
            testRegistry(),
            options.folder,
        );
        return disposables.add(cfg);
    }

    function events(cfg: ConfigurationService): IConfigurationChangeEvent[] {
        const seen: IConfigurationChangeEvent[] = [];
        disposables.add(cfg.onDidChangeConfiguration((e) => seen.push(e)));
        return seen;
    }

    describe("чтение", () => {
        it(".diode/settings.json папки — поверх user и профиля; inspect и данные для хоста видят слой", async () => {
            writeUser(`{ "editor.tabSize": 2 }`);
            writeUser(`{ "workbench.colorTheme": "Light" }`, "compact");
            folder.writeFile(".diode/settings.json", `{ "editor.tabSize": 8, "workbench.colorTheme": "Solar" }`);

            const cfg = await load({ folder: folder.dir, profile: "compact" });

            expect(cfg.get("editor.tabSize")).toBe(8);
            expect(cfg.get("workbench.colorTheme")).toBe("Solar");
            expect(cfg.inspect("editor.tabSize")).toEqual({
                default: 4,
                user: 2,
                profile: undefined,
                workspace: 8,
                value: 8,
            });
            expect(cfg.getConfigurationData().workspace).toEqual({
                editor: { tabSize: 8 },
                workbench: { colorTheme: "Solar" },
            });
        });

        it(".vscode/settings.json НЕ читается — у Diode свой каталог", async () => {
            folder.writeFile(".vscode/settings.json", `{ "editor.tabSize": 8 }`);

            const cfg = await load({ folder: folder.dir });

            expect(cfg.get("editor.tabSize")).toBe(4);
            expect(cfg.getConfigurationData().workspace).toEqual({});
        });

        it("без папки и без файла слой пуст", async () => {
            const noFolder = await load();
            expect(noFolder.inspect("editor.tabSize").workspace).toBeUndefined();
            expect(noFolder.getConfigurationData().workspace).toEqual({});

            const noFile = await load({ folder: folder.dir });
            expect(noFile.getConfigurationData().workspace).toEqual({});
        });

        it("секция языка из воркспейса действует для языка", async () => {
            folder.writeFile(".diode/settings.json", `{ "[go]": { "editor.tabSize": 8 } }`);

            const cfg = await load({ folder: folder.dir });

            expect(cfg.get("editor.tabSize")).toBe(4);
            expect(cfg.get("editor.tabSize", { overrideIdentifier: "go" })).toBe(8);
        });

        it("ключи application/machine из воркспейса не действуют — и в секции языка; лог называет их", async () => {
            writeUser(`{ "terminal.tier": "legacy" }`);
            folder.writeFile(
                ".diode/settings.json",
                JSON.stringify({
                    "terminal.tier": "kitty",
                    "update.mode": "none",
                    "java.secret": "/x",
                    "java.home": "/jdk",
                    "unknown.key": 1,
                    "files.exclude": { out: true },
                    "[go]": { "terminal.tier": "kitty", "editor.tabSize": 8 },
                }),
            );
            const logger = makeLogger();

            const cfg = await load({ folder: folder.dir, logger });

            // machine/application — значение из user, воркспейс не перебивает.
            expect(cfg.get("terminal.tier")).toBe("legacy");
            expect(cfg.get("update.mode")).toBe("default");
            expect(cfg.get("java.secret")).toBeUndefined();
            expect(cfg.inspect("terminal.tier").workspace).toBeUndefined();
            // machine-overridable, незарегистрированный и resource — действуют.
            expect(cfg.get("java.home")).toBe("/jdk");
            expect(cfg.get("unknown.key")).toBe(1);
            expect(cfg.get("files.exclude")).toEqual({ out: true });
            // В секции языка отброшен только machine-ключ.
            expect(cfg.get("terminal.tier", { overrideIdentifier: "go" })).toBe("legacy");
            expect(cfg.get("editor.tabSize", { overrideIdentifier: "go" })).toBe(8);
            // Хост тоже получает уже отфильтрованный слой.
            expect(cfg.getConfigurationData().workspace).toEqual({
                java: { home: "/jdk" },
                unknown: { key: 1 },
                files: { exclude: { out: true } },
                "[go]": { editor: { tabSize: 8 } },
            });
            expect(logger.warn).toHaveBeenCalledTimes(1);
            const message = logger.warn.mock.calls[0][0];
            expect(message).toContain(path.join(folder.dir, ".diode", "settings.json"));
            expect(message).toContain("ignored settings that can be set only in User settings");
            // Список — через запятую, в порядке реестра, секция языка — следом за ключом.
            expect(message.endsWith(": terminal.tier, [go].terminal.tier, update.mode, java.secret")).toBe(true);
        });

        it("отброшенные ключи без логгера — не падение", async () => {
            folder.writeFile(".diode/settings.json", `{ "terminal.tier": "kitty" }`);

            const cfg = await load({ folder: folder.dir });

            expect(cfg.get("terminal.tier")).toBe("auto");
        });

        it("чистый файл воркспейса в лог не пишет", async () => {
            folder.writeFile(".diode/settings.json", `{ "editor.tabSize": 8 }`);
            const logger = makeLogger();

            await load({ folder: folder.dir, logger });

            expect(logger.warn).not.toHaveBeenCalled();
        });

        it("битый JSONC воркспейса — ошибка в лог и частичный разбор, как у user-файла", async () => {
            folder.writeFile(".diode/settings.json", `{ "editor.tabSize": 8, oops }`);
            const logger = makeLogger();

            const cfg = await load({ folder: folder.dir, logger });

            expect(logger.error).toHaveBeenCalled();
            expect(cfg.get("editor.tabSize")).toBe(8);
        });
    });

    describe("смена папки", () => {
        it("Open Folder: слой перечитывается, событие несёт изменившиеся ключи; та же папка — no-op", async () => {
            const other = createTempWorkspace({ prefix: "diode-cfg-ws2-" });
            try {
                folder.writeFile(".diode/settings.json", `{ "editor.tabSize": 8 }`);
                other.writeFile(".diode/settings.json", `{ "workbench.colorTheme": "Solar" }`);
                const watcher = new FakeFileWatcher();
                const cfg = await load({ folder: folder.dir, watcher });
                const seen = events(cfg);
                const file = path.join(folder.dir, ".diode", "settings.json");

                // Тот же путь в другом написании — та же папка: ни события, ни
                // перевешивания watch'а (перевес на тот же путь снял бы его).
                await cfg.setWorkspaceFolders([path.join(folder.dir, ".")]);
                expect(seen).toHaveLength(0);
                expect(watcher.watched()).toContain(file);

                await cfg.setWorkspaceFolders([other.dir]);
                expect(cfg.get("editor.tabSize")).toBe(4);
                expect(cfg.get("workbench.colorTheme")).toBe("Solar");
                expect(seen).toHaveLength(1);
                expect([...seen[0].affectedKeys].sort()).toEqual(["editor.tabSize", "workbench.colorTheme"]);

                await cfg.setWorkspaceFolders([]);
                expect(cfg.get("workbench.colorTheme")).toBe("Dark");
                expect(cfg.getConfigurationData().workspace).toEqual({});
                expect(seen).toHaveLength(2);
            } finally {
                other.dispose();
            }
        });

        it("закрытие папки посреди загрузки её слоя: побеждает закрытие", async () => {
            folder.writeFile(".diode/settings.json", `{ "editor.tabSize": 8 }`);
            const cfg = await load();

            // Открытие ждёт диска, закрытие — нет: оно кончится первым.
            const opening = cfg.setWorkspaceFolders([folder.dir]);
            await cfg.setWorkspaceFolders([]);
            await opening;

            expect(cfg.get("editor.tabSize")).toBe(4);
            expect(cfg.getConfigurationData().workspace).toEqual({});
        });

        it("без папки слой не читается вовсе: ни при закрытии, ни при reload — ошибок в логе нет", async () => {
            const logger = makeLogger();
            const cfg = await load({ folder: folder.dir, logger });

            await cfg.setWorkspaceFolders([]);
            await cfg.reload();

            expect(logger.error).not.toHaveBeenCalled();
        });

        it("из пустого окна: папка без .diode/settings.json событий не даёт", async () => {
            const cfg = await load();
            const seen = events(cfg);

            await cfg.setWorkspaceFolders([folder.dir]);

            expect(seen).toHaveLength(0);
            expect(cfg.getConfigurationData().workspace).toEqual({});
        });

        it("смена папки посреди загрузки: побеждает последняя", async () => {
            const other = createTempWorkspace({ prefix: "diode-cfg-ws2-" });
            try {
                folder.writeFile(".diode/settings.json", `{ "editor.tabSize": 8 }`);
                other.writeFile(".diode/settings.json", `{ "editor.tabSize": 2 }`);
                const cfg = await load();

                // Не ждём первую — вторая начинается, пока первая читает файл.
                const first = cfg.setWorkspaceFolders([folder.dir]);
                const second = cfg.setWorkspaceFolders([other.dir]);
                await Promise.all([first, second]);

                expect(cfg.get("editor.tabSize")).toBe(2);
                expect(cfg.inspect("editor.tabSize").workspace).toBe(2);
            } finally {
                other.dispose();
            }
        });
    });

    describe("live-reload", () => {
        it("следит за файлом воркспейса; правка на диске — новое значение и событие", async () => {
            const watcher = new FakeFileWatcher();
            const file = folder.writeFile(".diode/settings.json", `{ "editor.tabSize": 8 }`);
            const cfg = await load({ folder: folder.dir, watcher });
            const seen = events(cfg);
            expect(watcher.watched()).toContain(file);

            fs.writeFileSync(file, `{ "editor.tabSize": 3 }`);
            watcher.fire(file);
            await vi.waitFor(() => {
                expect(cfg.get("editor.tabSize")).toBe(3);
            });
            expect(seen).toHaveLength(1);
            expect(seen[0].affectedKeys).toEqual(["editor.tabSize"]);
        });

        it("файл появился позже (watch ждёт его с открытия папки)", async () => {
            const watcher = new FakeFileWatcher();
            const cfg = await load({ folder: folder.dir, watcher });
            const file = path.join(folder.dir, ".diode", "settings.json");
            expect(watcher.watched()).toContain(file);

            folder.writeFile(".diode/settings.json", `{ "editor.tabSize": 8 }`);
            watcher.fire(file);
            await vi.waitFor(() => {
                expect(cfg.get("editor.tabSize")).toBe(8);
            });
        });

        it("смена папки переносит watch; без папки watch'а нет", async () => {
            const watcher = new FakeFileWatcher();
            const cfg = await load({ watcher });
            const userFile = paths().settingsFile;
            expect(watcher.watched()).toEqual([userFile]);

            await cfg.setWorkspaceFolders([folder.dir]);
            expect(watcher.watched()).toEqual([userFile, path.join(folder.dir, ".diode", "settings.json")]);

            await cfg.setWorkspaceFolders([]);
            expect(watcher.watched()).toEqual([userFile]);
        });

        it("reload() перечитывает и слой воркспейса", async () => {
            const file = folder.writeFile(".diode/settings.json", `{ "editor.tabSize": 8 }`);
            const cfg = await load({ folder: folder.dir });

            fs.writeFileSync(file, `{ "editor.tabSize": 5 }`);
            await cfg.reload();

            expect(cfg.get("editor.tabSize")).toBe(5);
        });

        it("перечитывание, закончившееся после смены папки, свой слой не применяет", async () => {
            const watcher = new FakeFileWatcher();
            const file = folder.writeFile(".diode/settings.json", `{ "editor.tabSize": 8 }`);
            const cfg = await load({ folder: folder.dir, watcher });

            fs.writeFileSync(file, `{ "editor.tabSize": 5 }`);
            // Перечитывание стартует и ждёт диска, а папку тем временем закрыли.
            watcher.fire(file);
            await cfg.setWorkspaceFolders([]);
            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(cfg.get("editor.tabSize")).toBe(4);
            expect(cfg.getConfigurationData().workspace).toEqual({});
        });

        it("событие watch'а старой папки после смены не возвращает её слой", async () => {
            const watcher = new FakeFileWatcher();
            const file = folder.writeFile(".diode/settings.json", `{ "editor.tabSize": 8 }`);
            const cfg = await load({ folder: folder.dir, watcher });
            const handler = (): void => {
                watcher.fire(file);
            };

            await cfg.setWorkspaceFolders([]);
            // Watch старой папки снят — колбэк никто не держит.
            handler();
            await cfg.reload();
            expect(cfg.get("editor.tabSize")).toBe(4);
        });
    });

    describe("запись", () => {
        it("цель workspace: создаёт .diode/settings.json, значение и событие сразу; user-файл не тронут", async () => {
            const cfg = await load({ folder: folder.dir });
            const seen = events(cfg);

            await cfg.updateValue("editor.tabSize", 8, "workspace");

            const file = path.join(folder.dir, ".diode", "settings.json");
            expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual({ "editor.tabSize": 8 });
            expect(fs.existsSync(paths().settingsFile)).toBe(false);
            expect(cfg.get("editor.tabSize")).toBe(8);
            expect(cfg.inspect("editor.tabSize").workspace).toBe(8);
            expect(seen).toHaveLength(1);
            expect(seen[0].affectedKeys).toEqual(["editor.tabSize"]);
        });

        it("новый файл пишется отступом в 4 пробела, как user settings.json", async () => {
            const cfg = await load({ folder: folder.dir });

            await cfg.updateValue("editor.tabSize", 8, "workspace");

            expect(fs.readFileSync(path.join(folder.dir, ".diode", "settings.json"), "utf-8")).toBe(
                '{\n    "editor.tabSize": 8\n}',
            );
        });

        it("нечитаемый файл (не ENOENT) — отказ записи, содержимое не перетёрто", async () => {
            const file = folder.writeFile(".diode/settings.json", `{ "workbench.colorTheme": "Solar" }`);
            const cfg = await load({ folder: folder.dir });
            // Только запись: чтение отказывает EACCES, а запись прошла бы.
            fs.chmodSync(file, 0o200);
            try {
                await expect(cfg.updateValue("editor.tabSize", 8, "workspace")).rejects.toThrow(/EACCES/);
            } finally {
                fs.chmodSync(file, 0o600);
            }
            expect(fs.readFileSync(file, "utf-8")).toBe(`{ "workbench.colorTheme": "Solar" }`);
        });

        it("цель workspace сохраняет комментарии; undefined снимает ключ", async () => {
            const file = folder.writeFile(
                ".diode/settings.json",
                `{\n    // тема проекта\n    "workbench.colorTheme": "Solar",\n    "editor.tabSize": 8\n}\n`,
            );
            const cfg = await load({ folder: folder.dir });

            await cfg.updateValue("editor.tabSize", undefined, "workspace");

            const written = fs.readFileSync(file, "utf-8");
            expect(written).toContain("// тема проекта");
            expect(written).not.toContain("editor.tabSize");
            expect(cfg.get("editor.tabSize")).toBe(4);
            expect(cfg.get("workbench.colorTheme")).toBe("Solar");
        });

        it("цель по умолчанию — user; undefined снимает ключ и там", async () => {
            writeUser(`{ "editor.tabSize": 2, "workbench.colorTheme": "Light" }`);
            const cfg = await load({ folder: folder.dir });

            await cfg.updateValue("editor.tabSize", undefined);

            expect(JSON.parse(fs.readFileSync(paths().settingsFile, "utf-8"))).toEqual({
                "workbench.colorTheme": "Light",
            });
            expect(cfg.get("editor.tabSize")).toBe(4);
            expect(fs.existsSync(path.join(folder.dir, ".diode"))).toBe(false);
        });

        it("без папки запись в воркспейс отклоняется текстом эталона", async () => {
            const cfg = await load();

            await expect(cfg.updateValue("editor.tabSize", 8, "workspace")).rejects.toThrow(
                "Unable to write to Workspace Settings because no workspace is opened. Please open a workspace first and try again.",
            );
        });

        it("ключ application/machine в воркспейс отклоняется, файл не создаётся", async () => {
            const cfg = await load({ folder: folder.dir });

            await expect(cfg.updateValue("update.mode", "none", "workspace")).rejects.toThrow(
                "Unable to write update.mode to Workspace Settings. This setting can be written only into User settings.",
            );
            await expect(cfg.updateValue("java.secret", "/x", "workspace")).rejects.toThrow(
                "Unable to write java.secret to Workspace Settings.",
            );
            expect(fs.existsSync(path.join(folder.dir, ".diode"))).toBe(false);

            // machine-overridable расширения — можно.
            await cfg.updateValue("java.home", "/jdk", "workspace");
            expect(cfg.get("java.home")).toBe("/jdk");
        });

        it("параллельные записи одного файла не теряют друг друга", async () => {
            const cfg = await load({ folder: folder.dir });

            await Promise.all([
                cfg.updateValue("editor.tabSize", 8, "workspace"),
                cfg.updateValue("workbench.colorTheme", "Solar", "workspace"),
                cfg.updateValue("editor.tabSize", 2),
                cfg.updateValue("workbench.colorTheme", "Light"),
            ]);

            const workspaceFile = path.join(folder.dir, ".diode", "settings.json");
            expect(JSON.parse(fs.readFileSync(workspaceFile, "utf-8"))).toEqual({
                "editor.tabSize": 8,
                "workbench.colorTheme": "Solar",
            });
            expect(JSON.parse(fs.readFileSync(paths().settingsFile, "utf-8"))).toEqual({
                "editor.tabSize": 2,
                "workbench.colorTheme": "Light",
            });
        });

        it("отказ одной записи не рвёт очередь", async () => {
            const cfg = await load({ folder: folder.dir });

            const rejected = cfg.updateValue("update.mode", "none", "workspace");
            const next = cfg.updateValue("editor.tabSize", 8, "workspace");

            await expect(rejected).rejects.toThrow();
            await expect(next).resolves.toBeUndefined();
            expect(cfg.get("editor.tabSize")).toBe(8);
        });

        it("сервис без реестра и путей: запись в воркспейс открытой папки работает", async () => {
            const cfg = disposables.add(
                new ConfigurationService({
                    defaultsLayer: ConfigurationModel.EMPTY,
                    userLayer: ConfigurationModel.EMPTY,
                    profileLayer: ConfigurationModel.EMPTY,
                }),
            );
            await cfg.setWorkspaceFolders([folder.dir]);

            await cfg.updateValue("any.key", 1, "workspace");

            expect(cfg.get("any.key")).toBe(1);
        });
    });
});
