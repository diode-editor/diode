import { describe, expect, it } from "vitest";

import { fuzzyMatchBestLower } from "../../../../base/common/fuzzySearch.ts";

import { FileIndex } from "./fileIndex.ts";
import { BASENAME_BONUS } from "./fileSearch.ts";

function indexOf(files: readonly string[], capacity?: number): FileIndex {
    const index = new FileIndex(capacity);
    for (const f of files) index.add(f);
    return index;
}

function paths(index: FileIndex, query: string, maxResults = 50): string[] {
    return index.search(query, maxResults).map((r) => r.relativePath);
}

describe("FileIndex — search()", () => {
    describe("empty query", () => {
        it("returns all files in insertion order, score 0, no indices", () => {
            const index = indexOf(["alpha.ts", "beta.ts", "gamma.ts"]);
            expect(index.search("", 50)).toEqual([
                { relativePath: "alpha.ts", score: 0, matchedIndices: [] },
                { relativePath: "beta.ts", score: 0, matchedIndices: [] },
                { relativePath: "gamma.ts", score: 0, matchedIndices: [] },
            ]);
        });

        it("respects maxResults", () => {
            expect(paths(indexOf(["alpha.ts", "beta.ts", "gamma.ts"]), "", 2)).toEqual(["alpha.ts", "beta.ts"]);
        });

        it("a whitespace-only query returns everything, like an empty one", () => {
            const index = indexOf(["src/other.ts", "src/main.ts", "lib/other.ts"]);
            expect(index.search("   ", 50).map((r) => r.score)).toEqual([0, 0, 0]);
        });
    });

    describe("basic matching", () => {
        const FILES = [
            "src/Controls/AppContainer.ts",
            "src/Workbench/Services/FileTreeDataProvider.ts",
            "src/Common/DiContainer.ts",
            "package.json",
        ];

        it("finds file by partial basename", () => {
            expect(paths(indexOf(FILES), "ac")).toContain("src/Controls/AppContainer.ts");
        });

        it("is case-insensitive in both directions", () => {
            const index = indexOf(FILES);
            expect(paths(index, "AC")).toEqual(paths(index, "ac"));
            expect(paths(index, "ac").length).toBeGreaterThan(0);
        });

        it("matches a lower-case path whose folded copy is not stored", () => {
            expect(paths(indexOf(["src/lower/plain.ts"]), "PLAIN")).toEqual(["src/lower/plain.ts"]);
        });

        it("matches an upper-case basename inside a lower-case directory by its folded copy", () => {
            expect(paths(indexOf(["src/README.md"]), "readme")).toEqual(["src/README.md"]);
        });

        it("returns empty array when nothing matches", () => {
            expect(indexOf(FILES).search("zzzzzz", 50)).toHaveLength(0);
        });

        it("respects maxResults on non-empty query", () => {
            const files = Array.from({ length: 20 }, (_, i) => `Component${String(i)}.ts`);
            expect(indexOf(files).search("comp", 5)).toHaveLength(5);
        });
    });

    describe("ranking", () => {
        it.each([
            ["ac", "AppContainer.ts", "abstract_class.ts"],
            ["fc", "FileContainer.ts", "first_contact.ts"],
            ["cr", "CommandRegistry.ts", "continuous_record.ts"],
        ])("word boundaries: %s ranks %s first", (query, winner, loser) => {
            expect(paths(indexOf([loser, winner]), query)[0]).toBe(winner);
        });

        it("a basename match outranks a path-only match by the basename bonus", () => {
            const index = indexOf(["controllers/actions/util.ts", "ActionContainer.ts"]);
            const results = index.search("ac", 50);
            expect(results.map((r) => r.relativePath)).toEqual(["ActionContainer.ts", "controllers/actions/util.ts"]);
            expect(results[0].score).toBeGreaterThanOrEqual(BASENAME_BONUS);
            expect(results[1].score).toBeLessThan(BASENAME_BONUS);
        });

        it("results are sorted by score descending", () => {
            const results = indexOf(["src/Controls/AppContainer.ts", "c.ts", "x/c/y.ts"]).search("c", 50);
            for (let i = 1; i < results.length; i++) {
                expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
            }
        });

        it("finds a path-only match through directories", () => {
            expect(paths(indexOf(["src/Controls/AppContainer.ts", "src/Common/AppConfig.ts"]), "ctrl")).toContain(
                "src/Controls/AppContainer.ts",
            );
        });

        it("basename indices are shifted into relativePath space", () => {
            const [hit] = indexOf(["a/b/c/d/e/DeepFile.ts"]).search("df", 50);
            expect(hit.matchedIndices).toEqual([10, 14]);
        });
    });

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

        // The raw matcher on every entry (basename, then full path), WITHOUT the prefilter.
        function referenceMatchSet(query: string): Set<string> {
            const q = query.toLowerCase();
            const out = new Set<string>();
            for (const rel of FILES) {
                const base = rel.slice(rel.lastIndexOf("/") + 1);
                if (
                    fuzzyMatchBestLower(q, base, base.toLowerCase()) !== null ||
                    fuzzyMatchBestLower(q, rel, rel.toLowerCase()) !== null
                ) {
                    out.add(rel);
                }
            }
            return out;
        }

        it("returns exactly the entries the raw matcher would, for many queries", () => {
            const index = indexOf(FILES);
            for (const query of [
                "ac",
                "fc",
                "fss",
                "fz",
                "search",
                "ctrl",
                "df",
                "json",
                "md",
                "zzz",
                "9x",
                "common",
            ]) {
                expect(new Set(paths(index, query, 1000)), query).toEqual(referenceMatchSet(query));
            }
        });
    });

    describe("multi-term query", () => {
        const TREE = ["src/other.ts", "src/main.ts", "lib/other.ts"];

        it("`src other` matches path + basename across the separator", () => {
            expect(paths(indexOf(TREE), "src other")).toEqual(["src/other.ts"]);
        });

        it("terms may appear in any order relative to the path", () => {
            expect(paths(indexOf(TREE), "other src")).toEqual(["src/other.ts"]);
        });

        it("every term must match — one missing term drops the entry", () => {
            expect(paths(indexOf(TREE), "src zebra")).toEqual([]);
        });

        it("a literal space in the filename is still findable", () => {
            expect(paths(indexOf(["file one.txt"]), "file one")).toEqual(["file one.txt"]);
        });

        it("repeated, leading and trailing spaces behave like a single one", () => {
            const index = indexOf(TREE);
            for (const query of ["src  other", " src other", "src other "]) {
                expect(paths(index, query), query).toEqual(["src/other.ts"]);
            }
        });

        it("matched indices arrive ascending, in relativePath space", () => {
            // "src/other.ts": `src` → 0..2 (directory), `other` → 4..8 (basename).
            expect(indexOf(["src/other.ts"]).search("src other", 50)[0].matchedIndices).toEqual([
                0, 1, 2, 4, 5, 6, 7, 8,
            ]);
        });

        it("a basename hit still outranks a directory-only hit", () => {
            expect(paths(indexOf(["other/src/deep.ts", "src/other.ts"]), "src other")).toEqual([
                "src/other.ts",
                "other/src/deep.ts",
            ]);
        });
    });
});

describe("FileIndex — capacity", () => {
    it("an empty index finds nothing", () => {
        expect(new FileIndex().search("anything", 50)).toEqual([]);
    });

    it("accepts paths up to the capacity, then refuses and reports full", () => {
        const index = new FileIndex(2);
        expect(index.add("a.ts")).toBe(true);
        expect(index.isFull).toBe(false);
        expect(index.add("b.ts")).toBe(true);
        expect(index.isFull).toBe(true);
        expect(index.add("c.ts")).toBe(false);
        expect(index.size).toBe(2);
        expect(paths(index, "")).toEqual(["a.ts", "b.ts"]);
    });
});
