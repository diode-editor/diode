import { afterAll, bench, describe } from "vitest";

import { cleanupDir, createTempDir, generateFileTree } from "../../../../../TestUtils/perfFixtures.ts";
import type { IFileIndexRequest } from "../common/fileSearch.ts";

import { FileSearchEngine } from "./fileSearchEngine.ts";

// Fixtures live at module top level, not in beforeAll: in `vitest bench` a heavy
// beforeAll prevents collecting samples. afterAll works as usual.

const dir1k = createTempDir("diode-perf-index-1k-");
generateFileTree(dir1k, { files: 1_000 });

const dir10k = createTempDir("diode-perf-index-10k-");
generateFileTree(dir10k, { files: 10_000 });

function request(folder: string, cacheKey = "bench"): IFileIndexRequest {
    return { cacheKey, folder, excludes: [], useIgnoreFiles: { local: true, parent: false, global: false } };
}

const searchEngine = new FileSearchEngine();
await searchEngine.index(request(dir10k));

afterAll(() => {
    searchEngine.dispose();
    cleanupDir(dir1k);
    cleanupDir(dir10k);
});

describe("FileSearchEngine.index (index build)", () => {
    bench("index 1000 files", async () => {
        const engine = new FileSearchEngine();
        await engine.index(request(dir1k));
        engine.dispose();
    });

    bench("index 10000 files", async () => {
        const engine = new FileSearchEngine();
        await engine.index(request(dir10k));
        engine.dispose();
    });
});

describe("FileSearchEngine.query (10k index)", () => {
    const query = (q: string) => searchEngine.query({ cacheKey: "bench", query: q, maxResults: 50 });

    bench("search empty query", async () => {
        await query("");
    });

    bench("search basename fragment", async () => {
        await query("module123");
    });

    bench("search path fragment (no basename match)", async () => {
        await query("dir2");
    });

    bench("search non-matching query", async () => {
        await query("zzzznomatch");
    });

    // Control point against the single-term "search path fragment": the matcher runs per
    // term, and splitting on spaces must not make it several times slower.
    bench("search two terms", async () => {
        await query("dir2 module");
    });
});
