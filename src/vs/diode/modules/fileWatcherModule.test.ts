import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { IDisposable } from "@tuidom/core/common/disposable";
import { afterEach, describe, expect, it } from "vitest";

import { ITreeFileWatcherDIToken } from "../../platform/files/common/iTreeFileWatcherDIToken.ts";
import { Container } from "../../platform/instantiation/common/diContainer.ts";
import type { LogEntry } from "../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../platform/log/common/iLogServiceDIToken.ts";
import { LogLevel } from "../../platform/log/common/logLevel.ts";
import { LogService } from "../../platform/log/common/logService.ts";

import { fileWatcherModule } from "./fileWatcherModule.ts";

/**
 * Проводка слежения за деревом в DI: продовый модуль поверх голого контейнера.
 * Проверяем не «биндинг объявлен», а что наружу приезжает именно **делящий**
 * обходы watcher и что его диагностика идёт в свой канал: собранный без
 * прослойки контейнер работает ровно так же и молча тратит обход на каждый
 * запрос.
 */
describe("fileWatcherModule", () => {
    const subscriptions: IDisposable[] = [];
    const roots: string[] = [];

    afterEach(() => {
        for (const subscription of subscriptions) subscription.dispose();
        subscriptions.length = 0;
        for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
        roots.length = 0;
    });

    it("вложенный запрос едет на обходе предка, и это видно в канале files.watcher", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-watcher-module-"));
        roots.push(root);
        fs.mkdirSync(path.join(root, "src"));
        const logService = new LogService();
        logService.setLevel("*", LogLevel.Trace);
        const entries: LogEntry[] = [];
        logService.addSink({ append: (entry) => entries.push(entry), dispose: () => undefined });
        const container = new Container().bind(ILogServiceDIToken, () => logService).use(fileWatcherModule);

        const watcher = container.get(ITreeFileWatcherDIToken);
        subscriptions.push(watcher.watchTree(root, { recursive: true, excludes: [] }, () => undefined));
        subscriptions.push(
            watcher.watchTree(path.join(root, "src"), { recursive: true, excludes: [] }, () => undefined),
        );

        expect(entries.at(-1)?.message).toContain("reusing");
        expect(entries.at(-1)?.channel).toBe("files.watcher");
    });
});
