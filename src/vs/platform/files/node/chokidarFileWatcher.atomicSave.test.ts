import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { Uri } from "../../../base/common/uri.ts";

import { ChokidarFileWatcher } from "./chokidarFileWatcher.ts";
import { DiskFileSystemProvider } from "./diskFileSystemProvider.ts";

/** Подписка, считающая уведомления. */
interface ICounter {
    readonly calls: () => number;
}

/**
 * Ждёт, пока все подписки начнут видеть запись: до события `ready` chokidar
 * считает найденное начальным состоянием и с `ignoreInitial` глотает. Пишет
 * файл на месте, пока каждая подписка не откликнется, и возвращает счётчики —
 * базу для дальнейших ассертов.
 */
async function untilWatching(file: string, counters: readonly ICounter[]): Promise<number[]> {
    await vi.waitFor(
        () => {
            fs.writeFileSync(file, "{}");
            expect(counters.every((c) => c.calls() > 0)).toBe(true);
        },
        { timeout: 10000, interval: 200 },
    );
    // Последняя проба могла ещё не долететь до кого-то — даём ей осесть.
    await vi.waitFor(async () => {
        const before = counters.map((c) => c.calls());
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(counters.map((c) => c.calls())).toEqual(before);
    });
    return counters.map((c) => c.calls());
}

/** Сохранение, как у редактора: временный сосед и `rename` поверх — inode файла новый. */
function save(file: string, content: string): Promise<void> {
    return new DiskFileSystemProvider().writeFile(Uri.file(file), new TextEncoder().encode(content), {
        atomic: true,
    });
}

/**
 * Настоящий chokidar на настоящем диске: баг жил в его общем на процесс
 * `fs.watch` на путь, фейк `createWatcher` его не видит.
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
        // Открытый в редакторе `.diode/settings.json`: за ним следят и модель
        // документа, и сервис настроек — каждый своим экземпляром watcher'а.
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
        // Сценарий «Preferences: Open Workspace Settings»: каталога ещё нет,
        // команда создаёт его с заготовкой, документ открывается и сохраняется.
        const file = path.join(ws.dir, ".diode", "settings.json");
        const settings = watch(file);
        // Каталог, созданный до готовности chokidar, событием не придёт — тогда
        // сносим его и создаём заново, пока подписка не откликнется. Через
        // попытку: удаление и создание подряд chokidar видит как «каталог был и есть».
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
