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
import {
    FILES_EXCLUDE_SETTING,
    SEARCH_EXCLUDE_SETTING,
    SEARCH_USE_GLOBAL_IGNORE_FILES_SETTING,
    SEARCH_USE_IGNORE_FILES_SETTING,
    SEARCH_USE_PARENT_IGNORE_FILES_SETTING,
} from "../../../common/configuration/excludeSettings.ts";

import { FileSearchService } from "./fileSearchService.ts";

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
        return {
            default: undefined,
            user: undefined,
            profile: undefined,
            workspace: undefined,
            workspaceFolder: undefined,
            value: undefined,
        };
    }
    public onDidChangeConfiguration(listener: (event: IConfigurationChangeEvent) => void): { dispose: () => void } {
        this.listeners.push(listener);
        return {
            dispose: () => {
                /* subscriptions live until the test ends */
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
        vi.unstubAllEnvs();
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

            // Fake Date only: setImmediate/setTimeout stay real so the walk still runs.
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
        it("the index cuts by BOTH sets: files.exclude and search.exclude", () => {
            config.values[FILES_EXCLUDE_SETTING] = { "**/.git": true };
            config.values[SEARCH_EXCLUDE_SETTING] = { "**/node_modules": true };
            ws.writeFile(".git/COMMIT_EDITMSG", "");
            ws.writeFile("node_modules/some-pkg/index.js", "");
            ws.writeFile("src/main.ts", "");

            return service.activate(ws.dir).then(() => {
                expect(indexedPaths(service)).toEqual(["src/main.ts"]);
            });
        });

        it("dot files are indexed: settings cut service files, not the dot in the name", async () => {
            ws.writeFile(".github/workflows/ci.yml", "");
            ws.writeFile(".editorconfig", "");
            await service.activate(ws.dir);

            expect(indexedPaths(service).toSorted()).toEqual([".editorconfig", ".github/workflows/ci.yml"]);
        });

        it("without settings excludes nothing: there is no hardcoded list anymore", async () => {
            ws.writeFile("node_modules/some-pkg/index.js", "");
            ws.writeFile(".git/COMMIT_EDITMSG", "");
            await service.activate(ws.dir);

            expect(indexedPaths(service).toSorted()).toEqual([".git/COMMIT_EDITMSG", "node_modules/some-pkg/index.js"]);
        });

        it("a pattern matches against the path RELATIVE to the root, in posix form", async () => {
            // `**/<name>` must reach a nested directory, `<name>` only a root entry. Segments are
            // joined with `/`, not `path.sep` — otherwise on Windows no glob would match `pkg/out`.
            config.values[FILES_EXCLUDE_SETTING] = { "**/__pycache__": true, out: true };
            ws.writeFile("pkg/__pycache__/app.cpython-312.pyc", "");
            ws.writeFile("pkg/out/keep.txt", "");
            ws.writeFile("out/bundle.js", "");
            ws.writeFile("pkg/app.py", "");
            await service.activate(ws.dir);

            expect(indexedPaths(service).toSorted()).toEqual(["pkg/app.py", "pkg/out/keep.txt"]);
        });

        it("a pattern does not hit a same-named FILE in another directory", async () => {
            config.values[FILES_EXCLUDE_SETTING] = { "**/.git": true };
            ws.writeFile(".gitignore", "");
            await service.activate(ws.dir);

            expect(indexedPaths(service)).toContain(".gitignore");
        });

        it("a setting change rebuilds the index immediately, without a restart", async () => {
            ws.writeFile("__pycache__/app.cpython-312.pyc", "");
            ws.writeFile("app.py", "");
            await service.activate(ws.dir);
            expect(indexedPaths(service)).toHaveLength(2);

            config.set(FILES_EXCLUDE_SETTING, { "**/__pycache__": true });
            await service.ready;
            expect(indexedPaths(service)).toEqual(["app.py"]);

            config.set(FILES_EXCLUDE_SETTING, { "**/__pycache__": false });
            await service.ready;
            expect(indexedPaths(service)).toHaveLength(2);
        });

        it("an unrelated setting does not touch the index", async () => {
            ws.writeFile("app.py", "");
            await service.activate(ws.dir);
            const before = service.ready;

            config.set("editor.tabSize", 2);

            expect(service.ready).toBe(before);
        });

        it("a change before activate() does not start a walk", () => {
            expect(() => {
                config.set(FILES_EXCLUDE_SETTING, { "**/x": true });
            }).not.toThrow();
            expect(service.isIndexed).toBe(false);
        });

        it("a change after dispose() does not start a walk", async () => {
            ws.writeFile("app.py", "");
            await service.activate(ws.dir);
            service.dispose();
            const before = service.ready;

            config.set(FILES_EXCLUDE_SETTING, { "**/app.py": true });

            expect(service.ready).toBe(before);
        });
    });

    describe("ignore files (search.useIgnoreFiles and siblings)", () => {
        it(".gitignore cuts the index by default, even outside a git repository", async () => {
            // The temp directory is not a repository: without `--no-require-git` rg
            // would not read `.gitignore` here, while upstream honors it.
            ws.writeFile(".gitignore", "dist/\n*.log\n");
            ws.writeFile("dist/bundle.js", "");
            ws.writeFile("debug.log", "");
            ws.writeFile("src/main.ts", "");
            await service.activate(ws.dir);

            expect(indexedPaths(service).toSorted()).toEqual([".gitignore", "src/main.ts"]);
        });

        it(".ignore in a nested directory applies to its subtree", async () => {
            ws.writeFile("pkg/.ignore", "generated/\n");
            ws.writeFile("pkg/generated/api.ts", "");
            ws.writeFile("pkg/index.ts", "");
            ws.writeFile("generated/keep.ts", "");
            await service.activate(ws.dir);

            expect(indexedPaths(service).toSorted()).toEqual(["generated/keep.ts", "pkg/.ignore", "pkg/index.ts"]);
        });

        it("useIgnoreFiles: false brings back the ignored entries, exclude settings still apply", async () => {
            config.values[SEARCH_USE_IGNORE_FILES_SETTING] = false;
            config.values[SEARCH_EXCLUDE_SETTING] = { "**/node_modules": true };
            ws.writeFile(".gitignore", "dist/\n");
            ws.writeFile("dist/bundle.js", "");
            ws.writeFile("node_modules/pkg/index.js", "");
            await service.activate(ws.dir);

            expect(indexedPaths(service).toSorted()).toEqual([".gitignore", "dist/bundle.js"]);
        });

        it("the ignore file of the root's parent applies only with useParentIgnoreFiles", async () => {
            ws.writeFile(".gitignore", "*.log\n");
            ws.writeFile("project/debug.log", "");
            ws.writeFile("project/main.ts", "");
            const root = ws.path("project");

            await service.activate(root);
            expect(indexedPaths(service).toSorted()).toEqual(["debug.log", "main.ts"]);

            config.set(SEARCH_USE_PARENT_IGNORE_FILES_SETTING, true);
            await service.ready;
            expect(indexedPaths(service)).toEqual(["main.ts"]);
        });

        it("global gitignore applies only with useGlobalIgnoreFiles", async () => {
            // rg looks for it in `$XDG_CONFIG_HOME/git/ignore` (if `~/.gitconfig`
            // has no `core.excludesFile`) — both are replaced with temp ones so the
            // machine's settings do not affect the test.
            vi.stubEnv("HOME", ws.path("home"));
            vi.stubEnv("XDG_CONFIG_HOME", ws.path("xdg"));
            ws.writeFile("xdg/git/ignore", "*.secret\n");
            ws.writeFile("project/key.secret", "");
            ws.writeFile("project/main.ts", "");
            const root = ws.path("project");

            await service.activate(root);
            expect(indexedPaths(service).toSorted()).toEqual(["key.secret", "main.ts"]);

            config.set(SEARCH_USE_GLOBAL_IGNORE_FILES_SETTING, true);
            await service.ready;
            expect(indexedPaths(service)).toEqual(["main.ts"]);
        });

        it("a useIgnoreFiles change rebuilds the index immediately", async () => {
            ws.writeFile(".gitignore", "dist/\n");
            ws.writeFile("dist/bundle.js", "");
            await service.activate(ws.dir);
            expect(indexedPaths(service)).toEqual([".gitignore"]);

            config.set(SEARCH_USE_IGNORE_FILES_SETTING, false);
            await service.ready;
            expect(indexedPaths(service).toSorted()).toEqual([".gitignore", "dist/bundle.js"]);
        });
    });
});
