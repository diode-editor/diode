import { afterAll, bench, describe } from "vitest";

import { cleanupDir, createTempDir, generateFileTree } from "../../../../../TestUtils/perfFixtures.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";

import { FileSearchService } from "./fileSearchService.ts";

// Fixtures live at module top level, not in beforeAll: in `vitest bench` a heavy
// beforeAll prevents collecting samples. afterAll works as usual.

const dir1k = createTempDir("diode-perf-index-1k-");
generateFileTree(dir1k, { files: 1_000 });

const dir10k = createTempDir("diode-perf-index-10k-");
generateFileTree(dir10k, { files: 10_000 });

const searchService = new FileSearchService(NULL_CONFIGURATION_SERVICE);
await searchService.activate(dir10k);

afterAll(() => {
    searchService.dispose();
    cleanupDir(dir1k);
    cleanupDir(dir10k);
});

describe("FileSearchService.activate (index build)", () => {
    bench("activate / index 1000 files", async () => {
        const service = new FileSearchService(NULL_CONFIGURATION_SERVICE);
        await service.activate(dir1k);
        service.dispose();
    });

    bench("activate / index 10000 files", async () => {
        const service = new FileSearchService(NULL_CONFIGURATION_SERVICE);
        await service.activate(dir10k);
        service.dispose();
    });
});

describe("FileSearchService.search (10k index)", () => {
    bench("search empty query", () => {
        searchService.search("", 50);
    });

    bench("search basename fragment", () => {
        searchService.search("module123", 50);
    });

    bench("search path fragment (no basename match)", () => {
        searchService.search("dir2", 50);
    });

    bench("search non-matching query", () => {
        searchService.search("zzzznomatch", 50);
    });

    // Control point against the single-term "search path fragment": the matcher runs per
    // term, and splitting on spaces must not make it several times slower.
    bench("search two terms", () => {
        searchService.search("dir2 module", 50);
    });
});
