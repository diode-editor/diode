import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { Uri } from "../../../base/common/uri.ts";

import { ChokidarFileWatcher } from "./chokidarFileWatcher.ts";
import { DiskFileSystemProvider } from "./diskFileSystemProvider.ts";

interface ICounter {
    readonly calls: () => number;
}

/** Before `ready` chokidar with `ignoreInitial` swallows writes, so keep writing until every subscription responds. */
async function untilWatching(file: string, counters: readonly ICounter[]): Promise<number[]> {
    await vi.waitFor(
        () => {
            fs.writeFileSync(file, "{}");
            expect(counters.every((c) => c.calls() > 0)).toBe(true);
        },
        { timeout: 10000, interval: 200 },
    );
    // The last probe may not have reached everyone yet, so let it settle.
    await vi.waitFor(async () => {
        const before = counters.map((c) => c.calls());
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(counters.map((c) => c.calls())).toEqual(before);
    });
    return counters.map((c) => c.calls());
}

/** Saves like an editor does: a temporary sibling and a `rename` over it, so the file gets a new inode. */
function save(file: string, content: string): Promise<void> {
    return new DiskFileSystemProvider().writeFile(Uri.file(file), new TextEncoder().encode(content), {
        atomic: true,
    });
}

/**
 * Real chokidar on a real disk: the bug lived in its process-wide per-path
 * `fs.watch`, which a fake `createWatcher` doesn't see.
 */
describe("ChokidarFileWatcher — атомарное сохранение, настоящий chokidar", () => {
    let ws: ITempWorkspace;
    const handles: IDisposable[] = [];

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-file-watch-" });
    });

    afterEach(() => {
        for (const handle of handles.splice(0)) handle.dispose();
        ws.dispose();
    });

    function watch(file: string): ICounter {
        let calls = 0;
        handles.push(
            new ChokidarFileWatcher().watchFile(file, () => {
                calls++;
            }),
        );
        return { calls: () => calls };
    }

    it("два наблюдателя одного файла (модель документа и слой настроек) видят каждое сохранение", async () => {
        // `.diode/settings.json` open in the editor: both the document model and the
        // configuration service watch it, each with its own watcher instance.
        const file = ws.writeFile(".diode/settings.json", "{}");
        const settings = watch(file);
        const model = watch(file);
        const [settingsBase, modelBase] = await untilWatching(file, [settings, model]);

        for (let i = 1; i <= 3; i++) {
            await save(file, JSON.stringify({ i }));
            await vi.waitFor(() => {
                expect([settings.calls() - settingsBase, model.calls() - modelBase]).toEqual([i, i]);
            });
        }
    }, 30000);

    it("файл, созданный после подписки: и после создания видны сохранения обоим", async () => {
        const file = path.join(ws.dir, ".diode", "settings.json");
        const settings = watch(file);
        // A directory created before chokidar is ready produces no event, so delete and
        // recreate it until the subscription responds. On alternate attempts: chokidar sees
        // a delete immediately followed by a create as "the directory was there all along".
        const dir = path.dirname(file);
        await vi.waitFor(
            () => {
                if (settings.calls() === 0 && fs.existsSync(dir)) {
                    fs.rmSync(dir, { recursive: true });
                } else if (settings.calls() === 0) {
                    fs.mkdirSync(dir);
                    fs.writeFileSync(file, "{}\n");
                }
                expect(settings.calls()).toBeGreaterThan(0);
            },
            { timeout: 15000, interval: 500 },
        );
        const model = watch(file);
        const [settingsBase, modelBase] = await untilWatching(file, [settings, model]);

        for (let i = 1; i <= 2; i++) {
            await save(file, JSON.stringify({ i }));
            await vi.waitFor(() => {
                expect([settings.calls() - settingsBase, model.calls() - modelBase]).toEqual([i, i]);
            });
        }
    }, 30000);
});
