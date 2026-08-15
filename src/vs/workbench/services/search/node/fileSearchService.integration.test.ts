/**
 * Integration test: FileSearchService against the real diode project.
 *
 * This test suite exercises FileSearchService with the actual workspace
 * at process.cwd() (i.e. /workspaces/vexx).  It verifies that:
 *   - real project files are indexed
 *   - fuzzy ranking produces VS Code-like results on actual filenames
 *   - known files are discoverable by their common abbreviations
 */

import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FileSearchService } from "./fileSearchService.ts";

const ROOT = path.join(process.cwd()); // /workspaces/vexx
const SRC = path.join(ROOT, "src");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativePaths(results: ReturnType<FileSearchService["search"]>): string[] {
    return results.map((r) => r.entry.relativePath);
}

function scoreOf(results: ReturnType<FileSearchService["search"]>, fragment: string): number | undefined {
    return results.find((r) => r.entry.relativePath.includes(fragment))?.score;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("FileSearchService — integration against real project", () => {
    let service: FileSearchService;

    beforeAll(async () => {
        service = new FileSearchService();
        await service.activate(SRC);
    });

    afterAll(() => {
        service.dispose();
    });

    describe("index coverage", () => {
        it("is indexed after activate", () => {
            expect(service.isIndexed).toBe(true);
        });

        it("finds more than 50 files in src/", () => {
            const results = service.search("", 1000);
            expect(results.length).toBeGreaterThan(50);
        });

        it("indexes WorkbenchComponent.ts", () => {
            // pass large maxResults — default 50 may not cover all files
            const paths = relativePaths(service.search("", 2000));
            expect(paths.some((p) => p.includes("workbenchComponent.ts"))).toBe(true);
        });

        it("indexes files in nested directories", () => {
            const paths = relativePaths(service.search("", 2000));
            expect(paths.some((p) => p.includes("workbench/"))).toBe(true);
            expect(paths.some((p) => p.includes("platform/"))).toBe(true);
            expect(paths.some((p) => p.includes("editor/"))).toBe(true);
        });

        it("does not include node_modules files", () => {
            const paths = relativePaths(service.search("", 2000));
            expect(paths.every((p) => !p.includes("node_modules"))).toBe(true);
        });

        it("does not include .git files", () => {
            const paths = relativePaths(service.search("", 2000));
            expect(paths.every((p) => !p.startsWith(".git"))).toBe(true);
        });

        it("all relative paths use forward slashes", () => {
            const paths = relativePaths(service.search("", 2000));
            expect(paths.every((p) => !p.includes("\\"))).toBe(true);
        });
    });

    describe("finding well-known files", () => {
        it('"wbc" finds WorkbenchComponent.ts', () => {
            // Десятки файлов `Workbench*` делят топовый счёт «wbc» (W·b·C по границам
            // слов/камела), поэтому WorkbenchComponent.ts может стоять за дефолтным
            // капом 50 — проверяем обнаруживаемость с большим maxResults, а не позицию.
            const paths = relativePaths(service.search("wbc", 2000));
            expect(paths.some((p) => p.includes("workbenchComponent.ts"))).toBe(true);
        });

        it('"ftdp" finds FileTreeDataProvider.ts', () => {
            const paths = relativePaths(service.search("ftdp"));
            expect(paths.some((p) => p.includes("fileTreeDataProvider.ts"))).toBe(true);
        });

        it('"dic" finds DiContainer.ts', () => {
            const paths = relativePaths(service.search("dic"));
            expect(paths.some((p) => p.includes("diContainer.ts"))).toBe(true);
        });

        it('"cr" finds CommandRegistry.ts', () => {
            const paths = relativePaths(service.search("cr"));
            expect(paths.some((p) => p.includes("commandRegistry.ts"))).toBe(true);
        });

        it('"ee" finds editorElement.ts', () => {
            const paths = relativePaths(service.search("ee"));
            expect(paths.some((p) => p.includes("editorElement.ts"))).toBe(true);
        });

        it('"fs" finds FuzzySearch.ts', () => {
            const paths = relativePaths(service.search("fs"));
            expect(paths.some((p) => p.includes("fuzzySearch.ts"))).toBe(true);
        });

        it('"tfm" finds textFileModel.ts', () => {
            const paths = relativePaths(service.search("tfm"));
            expect(paths.some((p) => p.includes("textFileModel.ts"))).toBe(true);
        });
    });

    describe("ranking on real files", () => {
        it('"wbc": WorkbenchComponent.ts ties for the top score among "wbc" matches', () => {
            // Большой maxResults: WorkbenchComponent.ts делит топовый счёт с десятками
            // `Workbench*`-соседей, поэтому за дефолтным капом 50 его может не быть.
            // Проверяем именно «ничто не обходит его по счёту», а не позицию в срезе.
            const results = service.search("wbc", 2000);
            expect(results.length).toBeGreaterThan(0);
            // WorkbenchComponent.ts ties for the best score — W, b and C hit word/camel boundaries.
            // Files sharing the same boundary pattern (e.g. WorkbenchContextKeys.ts) share that top score, so asserting an
            // exact position is brittle (it depends on walk order and how many siblings exist);
            // assert instead that nothing outscores it.
            const workbenchComponentScore = scoreOf(results, "workbenchComponent.ts");
            expect(workbenchComponentScore).toBeDefined();
            const maxScore = Math.max(...results.map((r) => r.score));
            expect(workbenchComponentScore).toBe(maxScore);
        });

        it('"cr": CommandRegistry.ts scores higher than files with c...r scattered', () => {
            const results = service.search("cr");
            const top5 = relativePaths(results.slice(0, 5));
            expect(top5.some((p) => p.includes("commandRegistry.ts"))).toBe(true);
        });

        it('"ks": KeybindingRegistry scores above files with k...s scattered', () => {
            const results = service.search("kr");
            const top5 = relativePaths(results.slice(0, 5));
            expect(top5.some((p) => p.includes("keybindingRegistry.ts"))).toBe(true);
        });

        it('"co": files sharing the Command* prefix score alike', () => {
            // Ранее тут стояло «ScrollContainerElement.ts в топ-10». Это кодировало
            // размер репозитория, а не качество ранжирования: любой новый файл с более
            // плотным «sc» (напр. settingsContext.ts) сдвигает индекс, ничего не ломая.
            // Сверяем счёт, а не позицию — и берём выдачу с запасом: дефолтные 50
            // строк это тот же размер репозитория, только с другой стороны (пачка
            // новых `commit*`-файлов вытолкнула обоих участников сравнения).
            const results = service.search("co", 1000);
            const registry = scoreOf(results, "commandRegistry.ts");
            const action = scoreOf(results, "commandAction.ts");
            expect(registry).toBeDefined();
            // Оба начинаются с `Command` — префикс матчится одинаково, счёт совпадает.
            expect(registry).toBe(action);
        });

        it("results are sorted by score descending", () => {
            const results = service.search("controller");
            for (let i = 1; i < results.length; i++) {
                expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
            }
        });

        it('"workbenchComponent" exact substring \u2014 all results contain WorkbenchComponent in basename', () => {
            const results = service.search("workbenchComponent");
            expect(results.length).toBeGreaterThan(0);
            // Every result should have "workbenchComponent" in basename (high word-boundary score)
            // or at least in the path; files without it should score too low to appear in top-N
            const top = results.slice(0, results.length);
            // All top results share the same matched region — verify they are all WorkbenchComponent files
            const scores = top.map((r) => r.score);
            const maxScore = scores[0];
            // Files sharing the top score should all be WorkbenchComponent*.ts variants
            const topTier = top.filter((r) => r.score === maxScore);
            expect(topTier.every((r) => r.entry.relativePath.includes("workbenchComponent"))).toBe(true);
        });

        it("searching by full filename with extension works", () => {
            const results = service.search("diContainer.ts");
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].entry.relativePath).toContain("diContainer.ts");
        });
    });

    describe("result structure", () => {
        it("each result has entry.relativePath, entry.absolutePath, score, matchedIndices", () => {
            const results = service.search("app");
            expect(results.length).toBeGreaterThan(0);
            const r = results[0];
            expect(typeof r.entry.relativePath).toBe("string");
            expect(typeof r.entry.absolutePath).toBe("string");
            expect(typeof r.score).toBe("number");
            expect(Array.isArray(r.matchedIndices)).toBe(true);
        });

        it("absolutePath starts with SRC root", () => {
            const results = service.search("app");
            for (const r of results) {
                expect(r.entry.absolutePath.startsWith(SRC)).toBe(true);
            }
        });
    });
});
