import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, bench, describe } from "vitest";

import { cleanupDir, createTempDir } from "../../../../../TestUtils/perfFixtures.ts";

import { FileTreeDataProvider } from "./fileTreeDataProvider.ts";

// Бенчмарк раскрытия одного большого каталога в дереве файлов.
// Запуск: `npm run test:perf`.
//
// Диагностика: readDirectory делает readdirSync + sort + getFileIcon на каждый
// элемент. Это стоимость раскрытия одной директории с большим числом записей.
//
// NB: фикстуры строятся на верхнем уровне (см. комментарий в FileSearchService.bench.ts).

function makeDirWithEntries(count: number): string {
    const dir = createTempDir("diode-perf-readdir-");
    for (let i = 0; i < count; i++) {
        // Смесь файлов и директорий, как в реальном каталоге.
        if (i % 10 === 0) {
            fs.mkdirSync(path.join(dir, `subdir${i}`));
        } else {
            fs.writeFileSync(path.join(dir, `component${i}.tsx`), "");
        }
    }
    return dir;
}

const dir1k = makeDirWithEntries(1_000);
const dir5k = makeDirWithEntries(5_000);

const provider1k = new FileTreeDataProvider(dir1k);
const provider5k = new FileTreeDataProvider(dir5k);

afterAll(() => {
    provider1k.dispose();
    provider5k.dispose();
    cleanupDir(dir1k);
    cleanupDir(dir5k);
});

describe("FileTreeDataProvider.getChildren (one large dir)", () => {
    bench("getChildren over 1000 entries", () => {
        provider1k.getChildren();
    });

    bench("getChildren over 5000 entries", () => {
        provider5k.getChildren();
    });
});
