import { afterAll, bench, describe } from "vitest";

import { cleanupDir, createTempDir, generateFileTree } from "../../../../../TestUtils/perfFixtures.ts";

import { FileSearchService } from "./fileSearchService.ts";

// Бенчмарки построения индекса и поиска по нему.
// Запуск: `npm run test:perf`.
//
// `activate()` строит индекс в фоне чанкованным async-обходом (без блокировки
// event loop и без рекурсивного watcher'а). Бенч меряет суммарное время обхода.
// `search()` — линейный O(N) скан, но с дешёвым bitmask-отсевом (charMask,
// посчитан заранее в makeEntry) до дорогого fuzzy-match: запись без всех символов
// запроса отбрасывается одним целочисленным AND. Заметнее всего на селективных и
// непроходных запросах (см. docs/TODO/FileTreePerformance.md).
//
// NB: фикстуры строятся на верхнем уровне модуля, а не в beforeAll — в режиме
// `vitest bench` тяжёлая инициализация внутри beforeAll отрабатывает некорректно
// (бенч не набирает сэмплов). Очистка — через afterAll, он работает штатно.

// ─── Фикстуры (строятся один раз при импорте) ────────────────────────────────

const dir1k = createTempDir("diode-perf-index-1k-");
generateFileTree(dir1k, { files: 1_000 });

const dir10k = createTempDir("diode-perf-index-10k-");
generateFileTree(dir10k, { files: 10_000 });

// Готовый индекс для бенчей поиска (ждём завершения фонового обхода).
const searchService = new FileSearchService();
await searchService.activate(dir10k);

afterAll(() => {
    searchService.dispose();
    cleanupDir(dir1k);
    cleanupDir(dir10k);
});

// ─── Индексация: реальный стартовый расход activate() ────────────────────────

describe("FileSearchService.activate (index build)", () => {
    // Меряем полный фоновый обход (await ready). Обход чанкованный и уступает
    // event loop — bench измеряет суммарное время до готовности индекса.
    bench("activate / index 1000 files", async () => {
        const service = new FileSearchService();
        await service.activate(dir1k);
        service.dispose();
    });

    bench("activate / index 10000 files", async () => {
        const service = new FileSearchService();
        await service.activate(dir10k);
        service.dispose();
    });
});

// ─── Поиск по готовому индексу ───────────────────────────────────────────────

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
});
