import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, bench, describe } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { cleanupDir, createTempDir } from "../../../../../TestUtils/perfFixtures.ts";
import { NULL_TREE_FILE_WATCHER } from "../../../../platform/files/common/iTreeFileWatcher.ts";

import { FileTreeDataProvider } from "./fileTreeDataProvider.ts";

// Expanding one large directory: resolve by the file service (readdir + stat of symlink
// targets) + sort + getFileIcon per entry. `npm run test:perf`.
// NB: fixtures are built at module top level (see the comment in FileSearchService.bench.ts).

function makeDirWithEntries(count: number): string {
    const dir = createTempDir("diode-perf-readdir-");
    for (let i = 0; i < count; i++) {
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

const files = diskFileService();
const provider1k = new FileTreeDataProvider(
    dir1k,
    () => [],
    files,
    NULL_TREE_FILE_WATCHER,
    () => true,
);
const provider5k = new FileTreeDataProvider(
    dir5k,
    () => [],
    files,
    NULL_TREE_FILE_WATCHER,
    () => true,
);

afterAll(() => {
    provider1k.dispose();
    provider5k.dispose();
    files.dispose();
    cleanupDir(dir1k);
    cleanupDir(dir5k);
});

describe("FileTreeDataProvider.getChildren (one large dir)", () => {
    bench("getChildren over 1000 entries", async () => {
        await provider1k.getChildren();
    });

    bench("getChildren over 5000 entries", async () => {
        await provider5k.getChildren();
    });
});
