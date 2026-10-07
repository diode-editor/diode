import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createConfigurationChangeEvent } from "../../../../platform/configuration/common/configurationChangeEvent.ts";
import type {
    IConfigurationChangeEvent,
    IConfigurationData,
    IConfigurationInspectResult,
    IConfigurationService,
} from "../../../../platform/configuration/common/iConfigurationService.ts";
import { FILES_EXCLUDE_SETTING, SEARCH_EXCLUDE_SETTING } from "../../../common/configuration/excludeSettings.ts";

import { FileSearchService } from "./fileSearchService.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Настройки с изменяемой картой и живым событием — exclude'ы правятся на ходу. */
class StubConfig implements IConfigurationService {
    public values: Record<string, unknown> = {};
    private readonly listeners: ((event: IConfigurationChangeEvent) => void)[] = [];

    public get<T>(key: string, defaultValue?: T): T | undefined {
        return key in this.values ? (this.values[key] as T) : defaultValue;
    }
    public getValue(): unknown {
        return this.values;
    }
    public inspect<T>(): IConfigurationInspectResult<T> {
        return { default: undefined, user: undefined, profile: undefined, workspace: undefined, value: undefined };
    }
    public onDidChangeConfiguration(listener: (event: IConfigurationChangeEvent) => void): { dispose: () => void } {
        this.listeners.push(listener);
        return {
            dispose: () => {
                /* подписки живут до конца теста */
            },
        };
    }
    public getConfigurationData(): IConfigurationData {
        return { defaults: {}, user: this.values, workspace: {} };
    }
    public updateValue(key: string, value: unknown): Promise<void> {
        this.set(key, value);
        return Promise.resolve();
    }
    /** Ставит значение и эмитит событие — как reload() настоящего сервиса. */
    public set(key: string, value: unknown): void {
        this.values[key] = value;
        const event = createConfigurationChangeEvent([key]);
        for (const listener of [...this.listeners]) listener(event);
    }
}

function mkdir(dir: string, relPath: string): string {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(fullPath, { recursive: true });
    return fullPath;
}

function indexedPaths(service: FileSearchService): string[] {
    return service.search("").map((r) => r.entry.relativePath);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FileSearchService — indexing", () => {
    let ws: ITempWorkspace;
    let service: FileSearchService;
    let config: StubConfig;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-filesearch-index-" });
        config = new StubConfig();
        service = new FileSearchService(config);
    });

    afterEach(() => {
        service.dispose();
        ws.dispose();
        vi.useRealTimers();
    });

    describe("activate()", () => {
        it("sets isIndexed to true after the initial walk completes", async () => {
            expect(service.isIndexed).toBe(false);
            await service.activate(ws.dir);
            expect(service.isIndexed).toBe(true);
        });

        it("activate() returns the same promise as `ready`", async () => {
            const p = service.activate(ws.dir);
            await service.ready;
            await p;
            expect(service.isIndexed).toBe(true);
        });

        it("empty directory yields no results", async () => {
            await service.activate(ws.dir);
            expect(service.search("")).toHaveLength(0);
        });

        it("indexes flat list of files", async () => {
            ws.writeFile("alpha.ts", "");
            ws.writeFile("beta.ts", "");
            ws.writeFile("gamma.ts", "");
            await service.activate(ws.dir);

            const names = indexedPaths(service);
            expect(names).toContain("alpha.ts");
            expect(names).toContain("beta.ts");
            expect(names).toContain("gamma.ts");
        });

        it("indexes files recursively", async () => {
            ws.writeFile("src/Controls/AppContainer.ts", "");
            ws.writeFile("src/Common/DiContainer.ts", "");
            ws.writeFile("package.json", "");
            await service.activate(ws.dir);

            const paths = indexedPaths(service);
            expect(paths).toContain("src/Controls/AppContainer.ts");
            expect(paths).toContain("src/Common/DiContainer.ts");
            expect(paths).toContain("package.json");
        });

        it("relativePath always uses forward slashes", async () => {
            ws.writeFile("a/b/c.ts", "");
            await service.activate(ws.dir);

            for (const p of indexedPaths(service)) {
                expect(p).not.toContain("\\");
            }
        });

        it("relativePath is relative to rootPath (no leading slash)", async () => {
            ws.writeFile("src/main.ts", "");
            await service.activate(ws.dir);

            for (const p of indexedPaths(service)) {
                expect(p.startsWith("/")).toBe(false);
            }
        });

        it("absolutePath is an absolute path", async () => {
            ws.writeFile("src/main.ts", "");
            await service.activate(ws.dir);

            for (const r of service.search("")) {
                expect(path.isAbsolute(r.entry.absolutePath)).toBe(true);
            }
        });

        it("does not index directories, only files", async () => {
            mkdir(ws.dir, "emptyDir");
            ws.writeFile("real.ts", "");
            await service.activate(ws.dir);

            const paths = indexedPaths(service);
            expect(paths).not.toContain("emptyDir");
            expect(paths).toContain("real.ts");
        });

        it("tolerates a non-existent root (resolves, empty index)", async () => {
            await service.activate(ws.path("does-not-exist"));
            expect(service.isIndexed).toBe(true);
            expect(service.search("")).toHaveLength(0);
        });
    });

    describe("background / cancellation", () => {
        it("a dispose before the walk runs cancels indexing", async () => {
            ws.writeFile("a.ts", "");
            ws.writeFile("b.ts", "");
            const pending = service.activate(ws.dir);
            service.dispose();
            await pending;

            expect(service.isIndexed).toBe(false);
            expect(service.search("")).toHaveLength(0);
        });

        it("a newer activate supersedes an in-flight one", async () => {
            ws.writeFile("a.ts", "");
            const first = service.activate(ws.dir);
            const second = service.activate(ws.dir);
            await Promise.all([first, second]);

            expect(service.isIndexed).toBe(true);
            expect(indexedPaths(service)).toContain("a.ts");
        });
    });

    describe("refreshIfStale()", () => {
        it("is a no-op before activate (no root)", () => {
            expect(() => {
                service.refreshIfStale();
            }).not.toThrow();
            expect(service.search("")).toHaveLength(0);
        });

        it("does nothing while the index is still fresh", async () => {
            ws.writeFile("a.ts", "");
            await service.activate(ws.dir);

            // Add a file but do not advance time — refresh should skip (throttled).
            ws.writeFile("b.ts", "");
            service.refreshIfStale();
            await service.ready;

            const paths = indexedPaths(service);
            expect(paths).toContain("a.ts");
            expect(paths).not.toContain("b.ts");
        });

        it("does nothing after dispose", async () => {
            await service.activate(ws.dir);
            service.dispose();
            expect(() => {
                service.refreshIfStale();
            }).not.toThrow();
        });

        it("re-walks and picks up new files once stale", async () => {
            ws.writeFile("a.ts", "");
            await service.activate(ws.dir);
            const base = Date.now();

            ws.writeFile("b.ts", "");

            // Jump the clock forward past the staleness window (fake Date only,
            // leaving setImmediate/setTimeout real so the walk still runs).
            vi.useFakeTimers({ toFake: ["Date"] });
            vi.setSystemTime(new Date(base + 60_000));

            service.refreshIfStale();
            await service.ready;

            const paths = indexedPaths(service);
            expect(paths).toContain("a.ts");
            expect(paths).toContain("b.ts");
        });
    });

    describe("re-index reflects filesystem changes", () => {
        it("a removed file is gone after re-activate", async () => {
            const removed = ws.writeFile("to-delete.ts", "");
            ws.writeFile("keep.ts", "");
            await service.activate(ws.dir);
            expect(indexedPaths(service)).toContain("to-delete.ts");

            fs.unlinkSync(removed);
            await service.activate(ws.dir);

            const paths = indexedPaths(service);
            expect(paths).not.toContain("to-delete.ts");
            expect(paths).toContain("keep.ts");
        });
    });

    describe("exclusions", () => {
        it("индекс режет по ОБОИМ наборам: files.exclude и search.exclude", () => {
            // Поиск по именам файлов — это поиск, поэтому `search.exclude`
            // сюда входит наравне с `files.exclude`.
            config.values[FILES_EXCLUDE_SETTING] = { "**/.git": true };
            config.values[SEARCH_EXCLUDE_SETTING] = { "**/node_modules": true };
            ws.writeFile(".git/COMMIT_EDITMSG", "");
            ws.writeFile("node_modules/some-pkg/index.js", "");
            ws.writeFile("src/main.ts", "");

            return service.activate(ws.dir).then(() => {
                expect(indexedPaths(service)).toEqual(["src/main.ts"]);
            });
        });

        it("в исключённый каталог обход не заходит вовсе", async () => {
            config.values[SEARCH_EXCLUDE_SETTING] = { "**/node_modules": true };
            const readdir = vi.spyOn(fs.promises, "readdir");
            ws.writeFile("node_modules/some-pkg/index.js", "");
            await service.activate(ws.dir);

            const visited = readdir.mock.calls.map(([dir]) => String(dir));
            expect(visited.some((dir) => dir.includes("node_modules"))).toBe(false);
            readdir.mockRestore();
        });

        it("без настроек не исключает ничего — захардкоженного списка больше нет", async () => {
            ws.writeFile("node_modules/some-pkg/index.js", "");
            ws.writeFile(".git/COMMIT_EDITMSG", "");
            await service.activate(ws.dir);

            expect(indexedPaths(service).toSorted()).toEqual([".git/COMMIT_EDITMSG", "node_modules/some-pkg/index.js"]);
        });

        it("шаблон матчится против пути ОТНОСИТЕЛЬНО корня, в posix-форме", async () => {
            // `**/<имя>` обязан достать каталог НА ГЛУБИНЕ, а `<имя>` — только
            // вход в корне. Сегменты склеиваются через `/` (на Windows
            // `path.sep` другой) — иначе `pkg/out` превратился бы в `pkgout` и
            // ни один шаблон его бы не задел.
            config.values[FILES_EXCLUDE_SETTING] = { "**/__pycache__": true, out: true };
            ws.writeFile("pkg/__pycache__/app.cpython-312.pyc", "");
            ws.writeFile("pkg/out/keep.txt", "");
            ws.writeFile("out/bundle.js", "");
            ws.writeFile("pkg/app.py", "");
            await service.activate(ws.dir);

            expect(indexedPaths(service).toSorted()).toEqual(["pkg/app.py", "pkg/out/keep.txt"]);
        });

        it("шаблон не задевает одноимённый ФАЙЛ в другом каталоге", async () => {
            config.values[FILES_EXCLUDE_SETTING] = { "**/.git": true };
            ws.writeFile(".gitignore", "");
            await service.activate(ws.dir);

            expect(indexedPaths(service)).toContain(".gitignore");
        });

        it("правка настройки пересобирает индекс сразу, без перезапуска", async () => {
            ws.writeFile("__pycache__/app.cpython-312.pyc", "");
            ws.writeFile("app.py", "");
            await service.activate(ws.dir);
            expect(indexedPaths(service)).toHaveLength(2);

            config.set(FILES_EXCLUDE_SETTING, { "**/__pycache__": true });
            await service.ready;
            expect(indexedPaths(service)).toEqual(["app.py"]);

            // И обратно: погашенный шаблон возвращает файлы в индекс.
            config.set(FILES_EXCLUDE_SETTING, { "**/__pycache__": false });
            await service.ready;
            expect(indexedPaths(service)).toHaveLength(2);
        });

        it("чужая настройка индекс не трогает", async () => {
            ws.writeFile("app.py", "");
            await service.activate(ws.dir);
            const before = service.ready;

            config.set("editor.tabSize", 2);

            expect(service.ready).toBe(before);
        });

        it("правка до activate() обхода не запускает", () => {
            // Корня ещё нет (пустое окно) — пересобирать нечего.
            expect(() => {
                config.set(FILES_EXCLUDE_SETTING, { "**/x": true });
            }).not.toThrow();
            expect(service.isIndexed).toBe(false);
        });

        it("правка после dispose() обхода не запускает", async () => {
            ws.writeFile("app.py", "");
            await service.activate(ws.dir);
            service.dispose();
            const before = service.ready;

            config.set(FILES_EXCLUDE_SETTING, { "**/app.py": true });

            expect(service.ready).toBe(before);
        });
    });
});
