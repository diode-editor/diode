import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { fuzzyMatchBestLower } from "../../../../base/common/fuzzySearch.ts";

import { FileSearchService } from "./fileSearchService.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a service with a pre-populated temp directory and awaits the initial
 * background index build. `files` is a list of relative paths to create.
 */
async function makeService(files: string[]): Promise<{ service: FileSearchService; ws: ITempWorkspace }> {
    const ws = createTempWorkspace({ prefix: "diode-filesearch-search-" });
    for (const f of files) {
        ws.writeFile(f, "");
    }
    const service = new FileSearchService();
    await service.activate(ws.dir);
    return { service, ws };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FileSearchService — search()", () => {
    let ws: ITempWorkspace;
    let service: FileSearchService;

    afterEach(() => {
        service.dispose();
        ws.dispose();
    });

    // ── Empty query ────────────────────────────────────────────────────────────

    describe("empty query", () => {
        it("returns all files when query is empty", async () => {
            ({ service, ws } = await makeService(["alpha.ts", "beta.ts", "gamma.ts"]));
            const results = service.search("");
            expect(results).toHaveLength(3);
        });

        it("returns all results with score 0", async () => {
            ({ service, ws } = await makeService(["alpha.ts", "beta.ts", "gamma.ts"]));
            const results = service.search("");
            for (const r of results) {
                expect(r.score).toBe(0);
            }
        });

        it("respects maxResults", async () => {
            ({ service, ws } = await makeService(["alpha.ts", "beta.ts", "gamma.ts"]));
            const results = service.search("", 2);
            expect(results).toHaveLength(2);
        });
    });

    // ── Basic matching ─────────────────────────────────────────────────────────

    describe("basic matching", () => {
        const FILES = [
            "src/Controls/AppContainer.ts",
            "src/Workbench/Services/FileTreeDataProvider.ts",
            "src/Common/DiContainer.ts",
            "package.json",
        ];

        it("finds file by partial basename", async () => {
            ({ service, ws } = await makeService(FILES));
            const results = service.search("ac");
            const paths = results.map((r) => r.entry.relativePath);
            expect(paths.some((p) => p.includes("AppContainer"))).toBe(true);
        });

        it("is case-insensitive", async () => {
            ({ service, ws } = await makeService(FILES));
            const upper = service.search("AC");
            const lower = service.search("ac");
            expect(upper.map((r) => r.entry.relativePath)).toEqual(lower.map((r) => r.entry.relativePath));
        });

        it("returns empty array when nothing matches", async () => {
            ({ service, ws } = await makeService(FILES));
            const results = service.search("zzzzzz");
            expect(results).toHaveLength(0);
        });

        it("respects maxResults on non-empty query", async () => {
            ({ service, ws } = await makeService(["a/Container1.ts", "b/Container2.ts", "c/Container3.ts"]));
            const results = service.search("ctrl", 2);
            expect(results.length).toBeLessThanOrEqual(2);
        });
    });

    // ── Ranking: word-boundary ─────────────────────────────────────────────────

    describe("ranking — word boundaries", () => {
        it("AppContainer ranks above abstract_class for query 'ac'", async () => {
            ({ service, ws } = await makeService(["AppContainer.ts", "abstract_class.ts"]));
            const results = service.search("ac");
            expect(results[0].entry.relativePath).toBe("AppContainer.ts");
        });

        it("FileContainer ranks above first_contact for query 'fc'", async () => {
            ({ service, ws } = await makeService(["FileContainer.ts", "first_contact.ts"]));
            const results = service.search("fc");
            expect(results[0].entry.relativePath).toBe("FileContainer.ts");
        });

        it("CommandRegistry ranks above continuous_record for query 'cr'", async () => {
            ({ service, ws } = await makeService(["CommandRegistry.ts", "continuous_record.ts"]));
            const results = service.search("cr");
            expect(results[0].entry.relativePath).toBe("CommandRegistry.ts");
        });
    });

    // ── Ranking: basename vs path ──────────────────────────────────────────────

    describe("ranking — basename priority", () => {
        it("file matching in basename ranks above file matching only in path", async () => {
            // "ac" matches the basename "AppContainer.ts"
            // "ac" also matches "src/actions/config.ts" via path only
            ({ service, ws } = await makeService([
                "src/actions/config.ts", // 'a'ctions + 'c'onfig in path
                "AppContainer.ts", // basename match
            ]));
            const results = service.search("ac");
            expect(results[0].entry.relativePath).toBe("AppContainer.ts");
        });

        it("basename match score is higher than full-path-only match score", async () => {
            ({ service, ws } = await makeService([
                "controllers/actions/util.ts", // match in path dirs, not basename
                "ActionContainer.ts", // basename word-boundary match
            ]));
            const results = service.search("ac");
            const basenameIdx = results.findIndex((r) => r.entry.relativePath === "ActionContainer.ts");
            const pathIdx = results.findIndex((r) => r.entry.relativePath === "controllers/actions/util.ts");
            // Both should be found
            expect(basenameIdx).not.toBe(-1);
            expect(pathIdx).not.toBe(-1);
            // Basename should rank first (lower index)
            expect(basenameIdx).toBeLessThan(pathIdx);
        });
    });

    // ── Ranking: path search ───────────────────────────────────────────────────

    describe("ranking — path search", () => {
        it("finds files when query contains path separator segments", async () => {
            ({ service, ws } = await makeService(["src/Controls/AppContainer.ts", "src/Common/AppConfig.ts"]));
            // "ctrl" — 'c'ontrols matches 'c', then 'trl'
            const results = service.search("ctrl");
            const paths = results.map((r) => r.entry.relativePath);
            expect(paths.some((p) => p.includes("Controls"))).toBe(true);
        });

        it("deep nested file is found by basename", async () => {
            ({ service, ws } = await makeService(["a/b/c/d/e/DeepFile.ts"]));
            const results = service.search("df");
            const paths = results.map((r) => r.entry.relativePath);
            expect(paths).toContain("a/b/c/d/e/DeepFile.ts");
        });
    });

    // ── Result structure ──────────────────────────────────────────────────────

    describe("result structure", () => {
        it("result contains entry with relativePath and absolutePath", async () => {
            ({ service, ws } = await makeService(["src/Controls/AppContainer.ts"]));
            const results = service.search("ac");
            expect(results.length).toBeGreaterThan(0);
            const result = results[0];
            expect(result.entry.relativePath).toBeDefined();
            expect(result.entry.absolutePath).toBeDefined();
            expect(path.isAbsolute(result.entry.absolutePath)).toBe(true);
        });

        it("result contains score (number)", async () => {
            ({ service, ws } = await makeService(["src/Controls/AppContainer.ts"]));
            const results = service.search("ac");
            expect(typeof results[0].score).toBe("number");
        });

        it("result contains matchedIndices array", async () => {
            ({ service, ws } = await makeService(["src/Controls/AppContainer.ts"]));
            const results = service.search("ac");
            expect(Array.isArray(results[0].matchedIndices)).toBe(true);
        });

        it("results are sorted by score descending", async () => {
            ({ service, ws } = await makeService(["src/Controls/AppContainer.ts"]));
            const results = service.search("c");
            for (let i = 1; i < results.length; i++) {
                expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
            }
        });
    });

    // ── Bitmask prefilter: soundness ───────────────────────────────────────────

    describe("bitmask prefilter does not change results", () => {
        const FILES = [
            "src/Controls/AppContainer.ts",
            "src/Workbench/Services/FileTreeDataProvider.ts",
            "src/Controls/FileSearchService.ts",
            "src/Common/DiContainer.ts",
            "src/Common/FuzzySearch.ts",
            "package.json",
            "README.md",
            "a/b/c/d/e/DeepFile.ts",
        ];

        // Reference matcher mirroring search() but WITHOUT the bitmask prefilter:
        // every entry goes through fuzzyMatchBestLower (basename, then full path).
        function referenceMatchSet(files: string[], query: string): Set<string> {
            const q = query.toLowerCase();
            const out = new Set<string>();
            for (const rel of files) {
                const relLower = rel.toLowerCase();
                const base = rel.slice(rel.lastIndexOf("/") + 1);
                const baseLower = base.toLowerCase();
                if (
                    fuzzyMatchBestLower(q, base, baseLower) !== null ||
                    fuzzyMatchBestLower(q, rel, relLower) !== null
                ) {
                    out.add(rel);
                }
            }
            return out;
        }

        it("returns exactly the entries the raw matcher would, for many queries", async () => {
            ({ service, ws } = await makeService(FILES));
            const queries = ["ac", "fc", "fss", "fz", "search", "ctrl", "df", "json", "md", "zzz", "9x", "common"];
            for (const query of queries) {
                const got = new Set(service.search(query, 1000).map((r) => r.entry.relativePath));
                expect(got).toEqual(referenceMatchSet(FILES, query));
            }
        });

        it("every returned path contains all query characters (necessary condition)", async () => {
            ({ service, ws } = await makeService(FILES));
            for (const r of service.search("fss", 1000)) {
                const lower = r.entry.relativePath.toLowerCase();
                for (const ch of "fss") expect(lower.includes(ch)).toBe(true);
            }
        });
    });

    // ── Search before activate ─────────────────────────────────────────────────

    describe("search before activate", () => {
        it("returns empty array when not yet indexed", () => {
            const s = new FileSearchService();
            expect(s.search("anything")).toHaveLength(0);
            s.dispose();
        });
    });

    // ── Large result set ───────────────────────────────────────────────────────

    describe("maxResults capping", () => {
        it("never returns more than maxResults items", async () => {
            const files = Array.from({ length: 60 }, (_, i) => `file${String(i)}.ts`);
            ({ service, ws } = await makeService(files));
            const results = service.search("", 50);
            expect(results.length).toBeLessThanOrEqual(50);
        });

        it("custom maxResults is respected", async () => {
            const files = Array.from({ length: 20 }, (_, i) => `Component${String(i)}.ts`);
            ({ service, ws } = await makeService(files));
            const results = service.search("comp", 5);
            expect(results.length).toBeLessThanOrEqual(5);
        });
    });
});
