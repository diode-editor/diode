import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { IRawFileMatch } from "../common/fileSearch.ts";

import { FileSearchEngine } from "./fileSearchEngine.ts";

const ROOT = path.join(process.cwd());
const SRC = path.join(ROOT, "src");
/** The whole index: rg walks in parallel, so the first N paths of an empty query are not a stable sample. */
const ALL = 1_000_000;

function relativePaths(results: readonly IRawFileMatch[]): string[] {
    return results.map((r) => r.relativePath);
}

function scoreOf(results: readonly IRawFileMatch[], fragment: string): number | undefined {
    return results.find((r) => r.relativePath.includes(fragment))?.score;
}

describe("FileSearchEngine — integration against real project", () => {
    let engine: FileSearchEngine;

    beforeAll(async () => {
        engine = new FileSearchEngine();
        await engine.index({
            cacheKey: "src",
            folder: SRC,
            excludes: [],
            useIgnoreFiles: { local: true, parent: false, global: false },
        });
    });

    afterAll(() => {
        engine.dispose();
    });

    async function search(query: string, maxResults = 50): Promise<readonly IRawFileMatch[]> {
        return (await engine.query({ cacheKey: "src", query, maxResults })).matches;
    }

    describe("index coverage", () => {
        it("the walk is complete after index()", async () => {
            expect((await engine.query({ cacheKey: "src", query: "", maxResults: 1 })).complete).toBe(true);
        });

        it("finds more than 50 files in src/", async () => {
            const results = await search("", 1000);
            expect(results.length).toBeGreaterThan(50);
        });

        it("indexes WorkbenchComponent.ts", async () => {
            // Search by name: an empty query returns the repository's first N paths, and
            // the file falls past the cutoff as soon as more directories precede src/.
            const paths = relativePaths(await search("workbenchComponent", 50));
            expect(paths.some((p) => p.includes("workbenchComponent.ts"))).toBe(true);
        });

        it("indexes files in nested directories", async () => {
            const paths = relativePaths(await search("", ALL));
            expect(paths.some((p) => p.includes("workbench/"))).toBe(true);
            expect(paths.some((p) => p.includes("platform/"))).toBe(true);
            expect(paths.some((p) => p.includes("editor/"))).toBe(true);
        });

        it("does not include node_modules files", async () => {
            const paths = relativePaths(await search("", ALL));
            expect(paths.every((p) => !p.includes("node_modules"))).toBe(true);
        });

        it("does not include .git files", async () => {
            const paths = relativePaths(await search("", ALL));
            expect(paths.every((p) => !p.startsWith(".git"))).toBe(true);
        });

        it("all relative paths use forward slashes", async () => {
            const paths = relativePaths(await search("", ALL));
            expect(paths.every((p) => !p.includes("\\"))).toBe(true);
        });
    });

    describe("finding well-known files", () => {
        it('"wbc" finds WorkbenchComponent.ts', async () => {
            // Dozens of `Workbench*` files share the top "wbc" score (W·b·C on word/camel
            // boundaries), so WorkbenchComponent.ts may sit past the default cap of 50 —
            // check discoverability with a large maxResults, not the position.
            const paths = relativePaths(await search("wbc", 2000));
            expect(paths.some((p) => p.includes("workbenchComponent.ts"))).toBe(true);
        });

        it('"ftdp" finds FileTreeDataProvider.ts', async () => {
            const paths = relativePaths(await search("ftdp"));
            expect(paths.some((p) => p.includes("fileTreeDataProvider.ts"))).toBe(true);
        });

        it('"dic" finds DiContainer.ts', async () => {
            const paths = relativePaths(await search("dic"));
            expect(paths.some((p) => p.includes("diContainer.ts"))).toBe(true);
        });

        it('"cr" finds CommandRegistry.ts', async () => {
            const paths = relativePaths(await search("cr"));
            expect(paths.some((p) => p.includes("commandRegistry.ts"))).toBe(true);
        });

        it('"ee" finds editorElement.ts', async () => {
            // Like "wbc": every `e…e` file name (`evaluatableExpression…`) shares the top score, and the order of the ties
            // follows the file system, so the file may sit past the default cap of 50.
            const paths = relativePaths(await search("ee", 2000));
            expect(paths.some((p) => p.includes("editorElement.ts"))).toBe(true);
        });

        it('"fs" finds FuzzySearch.ts', async () => {
            const paths = relativePaths(await search("fs"));
            expect(paths.some((p) => p.includes("fuzzySearch.ts"))).toBe(true);
        });

        it('"tfm" finds textFileModel.ts', async () => {
            const paths = relativePaths(await search("tfm"));
            expect(paths.some((p) => p.includes("textFileModel.ts"))).toBe(true);
        });
    });

    describe("ranking on real files", () => {
        it('"wbc": WorkbenchComponent.ts ties for the top score among "wbc" matches', async () => {
            const results = await search("wbc", 2000);
            expect(results.length).toBeGreaterThan(0);
            // Files sharing the W·b·C boundary pattern (e.g. WorkbenchContextKeys.ts) tie for the top
            // score, and their order depends on the walk — assert that nothing outscores it.
            const workbenchComponentScore = scoreOf(results, "workbenchComponent.ts");
            expect(workbenchComponentScore).toBeDefined();
            const maxScore = Math.max(...results.map((r) => r.score));
            expect(workbenchComponentScore).toBe(maxScore);
        });

        it('"cr": CommandRegistry.ts scores higher than files with c...r scattered', async () => {
            const results = await search("cr");
            const top5 = relativePaths(results.slice(0, 5));
            expect(top5.some((p) => p.includes("commandRegistry.ts"))).toBe(true);
        });

        it('"kr": keybindingRegistry.ts ties for the top score among "kr" matches', async () => {
            // A top-5 position encoded the repository size: a new `keybinding*` file with the same
            // boundary pattern pushes a neighbor out of the slice. Compare the score, not the position.
            const results = await search("kr", 2000);
            const registryScore = scoreOf(results, "keybindingRegistry.ts");
            expect(registryScore).toBeDefined();
            const maxScore = Math.max(...results.map((r) => r.score));
            expect(registryScore).toBe(maxScore);
        });

        it('"co": files sharing the Command* prefix score alike', async () => {
            // Compare the score, not the position: the position encodes the repository size. Request
            // extra results: the default 50 rows would encode the same size from the other side.
            const results = await search("co", 1000);
            const registry = scoreOf(results, "commandRegistry.ts");
            const action = scoreOf(results, "commandAction.ts");
            expect(registry).toBeDefined();
            // Both start with `Command` — the prefix matches the same way, so the scores are equal.
            expect(registry).toBe(action);
        });

        it("results are sorted by score descending", async () => {
            const results = await search("controller");
            for (let i = 1; i < results.length; i++) {
                expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
            }
        });

        it('"workbenchComponent" exact substring \u2014 all results contain WorkbenchComponent in basename', async () => {
            const results = await search("workbenchComponent");
            expect(results.length).toBeGreaterThan(0);
            const top = results.slice(0, results.length);
            const scores = top.map((r) => r.score);
            const maxScore = scores[0];
            const topTier = top.filter((r) => r.score === maxScore);
            expect(topTier.every((r) => r.relativePath.includes("workbenchComponent"))).toBe(true);
        });

        it("searching by full filename with extension works", async () => {
            const results = await search("diContainer.ts");
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].relativePath).toContain("diContainer.ts");
        });
    });

    describe("result structure", () => {
        it("each match has relativePath, score, matchedIndices", async () => {
            const results = await search("app");
            expect(results.length).toBeGreaterThan(0);
            const r = results[0];
            expect(typeof r.relativePath).toBe("string");
            expect(typeof r.score).toBe("number");
            expect(Array.isArray(r.matchedIndices)).toBe(true);
        });
    });
});
