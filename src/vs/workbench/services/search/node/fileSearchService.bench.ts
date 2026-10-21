import { afterAll, bench, describe } from "vitest";

import { cleanupDir, createTempDir, generateFileTree } from "../../../../../TestUtils/perfFixtures.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";

import { FileSearchService } from "./fileSearchService.ts";

// Фикстуры — на верхнем уровне модуля, а не в beforeAll: в `vitest bench` тяжёлый
// beforeAll не даёт набрать сэмплов. afterAll работает штатно.

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

    // Контрольная точка против одно-термового «search path fragment»: матчер идёт по
    // каждому терму, разбиение по пробелам не должно уехать в разы.
    bench("search two terms", () => {
        searchService.search("dir2 module", 50);
    });
});
