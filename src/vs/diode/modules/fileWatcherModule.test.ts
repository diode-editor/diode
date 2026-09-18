import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ITreeFileWatcherDIToken } from "../../platform/files/common/iTreeFileWatcherDIToken.ts";
import { SubprocessTreeWatcherDIToken } from "../../platform/files/node/subprocessTreeWatcher.ts";
import { Container } from "../../platform/instantiation/common/diContainer.ts";
import type { LogEntry } from "../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../platform/log/common/iLogServiceDIToken.ts";
import { LogLevel } from "../../platform/log/common/logLevel.ts";
import { LogService } from "../../platform/log/common/logService.ts";

import { fileWatcherModule } from "./fileWatcherModule.ts";

// Настоящий watcher-процесс здесь не нужен (его сквозняк — в
// treeWatcherMain.integration.test.ts); проверяем проводку: что продовый модуль
// уводит обход за границу процесса, а не ведёт его здесь.
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const { spawn } = await import("node:child_process");
const spawnMock = vi.mocked(spawn);

/** ChildProcess ровно настолько, насколько его трогает прокси. */
class FakeChild extends EventEmitter {
    public readonly sent: unknown[] = [];
    public readonly stderr = null;

    public send(message: unknown): boolean {
        this.sent.push(message);
        return true;
    }

    public kill(): boolean {
        return true;
    }
}

afterEach(() => {
    spawnMock.mockReset();
});

/**
 * Проводка слежения за деревом в DI: продовый модуль поверх голого контейнера.
 * Проверяем не «биндинг объявлен», а два свойства, ради которых он такой:
 * обход уезжает в отдельный процесс (иначе он снова сядет на главный цикл
 * редактора), и `main.ts` получает того же самого владельца процесса, которого
 * обязан снять при перезагрузке окна.
 */
describe("fileWatcherModule", () => {
    function setup(): { container: Container; entries: LogEntry[]; child: FakeChild } {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);
        const logService = new LogService();
        logService.setLevel("*", LogLevel.Trace);
        const entries: LogEntry[] = [];
        logService.addSink({ append: (entry) => entries.push(entry), dispose: () => undefined });
        const container = new Container().bind(ILogServiceDIToken, () => logService).use(fileWatcherModule);
        return { container, entries, child };
    }

    it("запрос на слежение уходит в отдельный процесс, а не поднимает обход здесь", () => {
        const { container, child } = setup();

        container
            .get(ITreeFileWatcherDIToken)
            .watchTree("/repo", { recursive: true, excludes: ["**/node_modules"] }, () => undefined);

        const [, , options] = spawnMock.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }];
        expect(options.env.DIODE_FILE_WATCHER).toBe("1");
        expect(child.sent).toEqual([
            { t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: ["**/node_modules"] } },
        ]);
    });

    it("оба токена дают один объект — main.ts гасит тот самый процесс, которым пользуются расширения", () => {
        const { container } = setup();

        expect(container.get(ITreeFileWatcherDIToken)).toBe(container.get(SubprocessTreeWatcherDIToken));
    });

    it("диагностика watcher-процесса идёт в канал files.watcher", () => {
        const { container, entries, child } = setup();
        container.get(ITreeFileWatcherDIToken).watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);

        child.emit("message", { t: "log", level: "warn", message: "tree watcher error", args: [{ code: "ENOSPC" }] });

        const entry = entries.at(-1);
        expect(entry?.channel).toBe("files.watcher");
        expect(entry?.message).toContain("tree watcher error");
    });
});
