import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import type { IUseIgnoreFiles } from "../../../common/configuration/excludeSettings.ts";
import type { IFileIndexRequest } from "../common/fileSearch.ts";

import { FileSearchEngine } from "./fileSearchEngine.ts";

const DEFAULT_IGNORE: IUseIgnoreFiles = { local: true, parent: false, global: false };

describe("FileSearchEngine — walking with rg", () => {
    let ws: ITempWorkspace;
    let engine: FileSearchEngine;
    let nextKey = 0;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-filesearch-engine-" });
        engine = new FileSearchEngine();
    });

    afterEach(() => {
        engine.dispose();
        ws.dispose();
        vi.unstubAllEnvs();
    });

    async function indexed(
        options: { folder?: string; excludes?: readonly string[]; useIgnoreFiles?: IUseIgnoreFiles } = {},
    ): Promise<string[]> {
        const request: IFileIndexRequest = {
            cacheKey: `k${String(nextKey++)}`,
            folder: options.folder ?? ws.dir,
            excludes: options.excludes ?? [],
            useIgnoreFiles: options.useIgnoreFiles ?? DEFAULT_IGNORE,
        };
        await engine.index(request);
        const result = await engine.query({ cacheKey: request.cacheKey, query: "", maxResults: 1000 });
        expect(result.complete).toBe(true);
        return result.matches.map((m) => m.relativePath).toSorted();
    }

    it("an empty directory yields no results", async () => {
        expect(await indexed()).toEqual([]);
    });

    it("indexes files recursively, posix paths relative to the folder, no directories", async () => {
        ws.writeFile("src/Controls/AppContainer.ts", "");
        ws.writeFile("package.json", "");
        fs.mkdirSync(ws.path("emptyDir"));
        expect(await indexed()).toEqual(["package.json", "src/Controls/AppContainer.ts"]);
    });

    it("tolerates a non-existent folder: the walk ends with an empty index", async () => {
        expect(await indexed({ folder: ws.path("does-not-exist") })).toEqual([]);
    });

    it("does not index a broken symlink", async () => {
        ws.writeFile("real.ts", "");
        fs.symlinkSync(ws.path("nonexistent-target"), ws.path("dangling"));
        expect(await indexed()).toEqual(["real.ts"]);
    });

    it("a fresh key sees files the previous walk did not", async () => {
        ws.writeFile("a.ts", "");
        expect(await indexed()).toEqual(["a.ts"]);
        ws.writeFile("b.ts", "");
        expect(await indexed()).toEqual(["a.ts", "b.ts"]);
    });

    describe("exclusions", () => {
        it("cuts by the excludes it is given", async () => {
            ws.writeFile(".git/COMMIT_EDITMSG", "");
            ws.writeFile("node_modules/some-pkg/index.js", "");
            ws.writeFile("src/main.ts", "");
            expect(await indexed({ excludes: ["**/.git", "**/node_modules"] })).toEqual(["src/main.ts"]);
        });

        it("dot files are indexed and nothing is excluded without excludes", async () => {
            ws.writeFile(".github/workflows/ci.yml", "");
            ws.writeFile("node_modules/some-pkg/index.js", "");
            expect(await indexed()).toEqual([".github/workflows/ci.yml", "node_modules/some-pkg/index.js"]);
        });

        it("a pattern matches against the path RELATIVE to the folder, in posix form", async () => {
            ws.writeFile("pkg/__pycache__/app.cpython-312.pyc", "");
            ws.writeFile("pkg/out/keep.txt", "");
            ws.writeFile("out/bundle.js", "");
            ws.writeFile("pkg/app.py", "");
            expect(await indexed({ excludes: ["**/__pycache__", "out"] })).toEqual(["pkg/app.py", "pkg/out/keep.txt"]);
        });
    });

    describe("ignore files", () => {
        it(".gitignore cuts the index by default, even outside a git repository", async () => {
            ws.writeFile(".gitignore", "dist/\n*.log\n");
            ws.writeFile("dist/bundle.js", "");
            ws.writeFile("debug.log", "");
            ws.writeFile("src/main.ts", "");
            expect(await indexed()).toEqual([".gitignore", "src/main.ts"]);
        });

        it("local: false brings back the ignored entries, excludes still apply", async () => {
            ws.writeFile(".gitignore", "dist/\n");
            ws.writeFile("dist/bundle.js", "");
            ws.writeFile("node_modules/pkg/index.js", "");
            expect(
                await indexed({
                    excludes: ["**/node_modules"],
                    useIgnoreFiles: { local: false, parent: false, global: false },
                }),
            ).toEqual([".gitignore", "dist/bundle.js"]);
        });

        it("the folder's parent ignore file applies only with parent: true", async () => {
            ws.writeFile(".gitignore", "*.log\n");
            ws.writeFile("project/debug.log", "");
            ws.writeFile("project/main.ts", "");
            const folder = ws.path("project");
            expect(await indexed({ folder })).toEqual(["debug.log", "main.ts"]);
            expect(await indexed({ folder, useIgnoreFiles: { local: true, parent: true, global: false } })).toEqual([
                "main.ts",
            ]);
        });

        it("the global gitignore applies only with global: true", async () => {
            // rg reads `$XDG_CONFIG_HOME/git/ignore`; both homes are temp so the machine's settings stay out.
            vi.stubEnv("HOME", ws.path("home"));
            vi.stubEnv("XDG_CONFIG_HOME", ws.path("xdg"));
            ws.writeFile("xdg/git/ignore", "*.secret\n");
            ws.writeFile("project/key.secret", "");
            ws.writeFile("project/main.ts", "");
            const folder = ws.path("project");
            expect(await indexed({ folder })).toEqual(["key.secret", "main.ts"]);
            expect(await indexed({ folder, useIgnoreFiles: { local: true, parent: false, global: true } })).toEqual([
                "main.ts",
            ]);
        });
    });
});
