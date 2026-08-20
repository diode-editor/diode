import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { FileWatcherAdapter } from "../../../api/browser/fileWatcherAdapter.ts";
import { ChokidarTreeWatcher } from "../../../../platform/files/node/chokidarTreeWatcher.ts";

/**
 * Сквозной тест `workspace.createFileSystemWatcher` на НАСТОЯЩЕМ субпроцессе и
 * НАСТОЯЩЕМ файловом watcher'е: тест трогает файлы на диске, а расширение
 * должно увидеть события. Проверяется весь путь целиком — chokidar в ядре →
 * матчинг шаблона на хосте → RPC → эмиттеры субпроцесса.
 */

const fixture = extensionFixture("diode.watch", "watchesFiles.cjs");

/** Реальный watcher, как в проде (`extensionHostModule`), но без excludes. */
function realWatcher(): FileWatcherAdapter {
    return new FileWatcherAdapter(new ChokidarTreeWatcher(), () => []);
}

/**
 * Даёт chokidar доскан­ировать дерево. До события `ready` он считает всё
 * найденное «начальным состоянием» и с `ignoreInitial: true` глотает — файл,
 * созданный в первые миллисекунды жизни watcher'а, до расширения не доедет.
 */
async function waitUntilWatching(): Promise<void> {
    await settle(400);
}

/** Ждёт, пока расширение увидит ожидаемое число событий (chokidar асинхронен). */
async function waitForEvents(
    harness: Awaited<ReturnType<typeof createExtensionTestHarness>>,
    count: number,
): Promise<string[]> {
    for (let attempt = 0; attempt < 60; attempt++) {
        await settle(50);
        const seen = (await harness.commandRegistry.execute("demo.watched")) as string[] | undefined;
        if (seen !== undefined && seen.length >= count) return seen;
    }
    return ((await harness.commandRegistry.execute("demo.watched")) as string[] | undefined) ?? [];
}

describe("workspace.createFileSystemWatcher — сквозь субпроцесс", () => {
    it("правка файла в рабочем дереве доезжает до расширения", async () => {
        const harness = await createExtensionTestHarness({ extensions: [fixture], fileWatcher: realWatcher() });
        try {
            await harness.flushRpc(6);
            await waitUntilWatching();
            const nested = path.join(harness.tmpDir, "src");
            fs.mkdirSync(nested, { recursive: true });

            fs.writeFileSync(path.join(nested, "a.ts"), "первая версия");
            const seen = await waitForEvents(harness, 1);

            expect(seen).toContain(`created ${path.join(nested, "a.ts")}`);
        } finally {
            await harness.dispose();
        }
    }, 20000);

    it("шаблон отсекает чужие файлы, ignoreChangeEvents — свой вид событий", async () => {
        const harness = await createExtensionTestHarness({ extensions: [fixture], fileWatcher: realWatcher() });
        try {
            await harness.flushRpc(6);
            await waitUntilWatching();
            const readme = path.join(harness.tmpDir, "readme.md");

            // `**/*.ts` не должен реагировать на .md, а `*.md`-watcher заведён с
            // ignoreChangeEvents — увидит только создание.
            fs.writeFileSync(readme, "первая версия");
            await waitForEvents(harness, 1);
            fs.writeFileSync(readme, "вторая версия");
            const seen = await waitForEvents(harness, 2);

            expect(seen).toContain(`md-created ${readme}`);
            expect(seen.filter((e) => e.startsWith("md-changed"))).toEqual([]);
            expect(seen.filter((e) => e.startsWith("changed") || e.startsWith("created"))).toEqual([]);
        } finally {
            await harness.dispose();
        }
    }, 20000);

    it("нерекурсивный RelativePattern не смотрит в подкаталоги", async () => {
        const harness = await createExtensionTestHarness({ extensions: [fixture], fileWatcher: realWatcher() });
        try {
            await harness.flushRpc(6);
            await waitUntilWatching();
            const nested = path.join(harness.tmpDir, "docs");
            fs.mkdirSync(nested, { recursive: true });

            fs.writeFileSync(path.join(nested, "deep.md"), "содержимое");
            await settle(600);
            const seen = ((await harness.commandRegistry.execute("demo.watched")) as string[]) ?? [];

            expect(seen.filter((e) => e.startsWith("md-"))).toEqual([]);
        } finally {
            await harness.dispose();
        }
    }, 20000);
});
