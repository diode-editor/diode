import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { LogEntry } from "../../log/common/iLogService.ts";
import { LogLevel } from "../../log/common/logLevel.ts";
import { LogService } from "../../log/common/logService.ts";

import { SubprocessTreeWatcher } from "./subprocessTreeWatcher.ts";

// Спавн замокан: проверяем **как** хост поднимает watcher-процесс (роль, stdio,
// проводка канала), не заводя настоящий. Сквозняк через реальный процесс — в
// treeWatcherMain.integration.test.ts.
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const { spawn } = await import("node:child_process");
const spawnMock = vi.mocked(spawn);

/** Минимальный ChildProcess: IPC-сообщения, сигналы и stderr. */
class FakeChild extends EventEmitter {
    public readonly sent: unknown[] = [];
    public readonly signals: string[] = [];
    public readonly stderr = new EventEmitter() as EventEmitter & { setEncoding: (enc: string) => void };

    public constructor(public readonly sendThrows = false) {
        super();
        this.stderr.setEncoding = () => undefined;
    }

    public send(message: unknown): boolean {
        if (this.sendThrows) throw new Error("channel closed");
        this.sent.push(message);
        return true;
    }

    public kill(signal: string): boolean {
        this.signals.push(signal);
        return true;
    }
}

function createLogService(): { logService: LogService; entries: LogEntry[] } {
    const logService = new LogService();
    logService.setLevel("*", LogLevel.Trace);
    const entries: LogEntry[] = [];
    logService.addSink({ append: (entry) => entries.push(entry), dispose: () => undefined });
    return { logService, entries };
}

const OPTIONS = { recursive: true, excludes: [] as readonly string[] };

afterEach(() => {
    spawnMock.mockReset();
});

describe("SubprocessTreeWatcher — боевой спавн", () => {
    it("поднимает САМ СЕБЯ с флагом роли DIODE_FILE_WATCHER", () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);
        const watcher = new SubprocessTreeWatcher();

        watcher.watchTree("/repo", OPTIONS, () => undefined);

        const [command, args, options] = spawnMock.mock.calls[0] as unknown as [
            string,
            readonly string[],
            { env: NodeJS.ProcessEnv },
        ];
        expect(command).toBe(process.execPath);
        expect(args).toContain(process.argv[1]); // dev-ветка selfSpawnArgs
        expect(options.env.DIODE_FILE_WATCHER).toBe("1");
    });

    it("stdout ребёнку закрыт (он делит терминал с редактором), IPC — открыт", () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);
        const watcher = new SubprocessTreeWatcher();

        watcher.watchTree("/repo", OPTIONS, () => undefined);

        const [, , options] = spawnMock.mock.calls[0] as unknown as [
            string,
            readonly string[],
            { stdio: readonly string[] },
        ];
        expect(options.stdio).toEqual(["ignore", "ignore", "pipe", "ipc"]);
    });

    it("запрос уезжает в IPC-канал ребёнка", () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);
        const watcher = new SubprocessTreeWatcher();

        watcher.watchTree("/repo", OPTIONS, () => undefined);

        expect(child.sent).toEqual([{ t: "watch", id: 1, rootPath: "/repo", options: OPTIONS }]);
    });

    it("пачка из ребёнка доезжает до подписчика", () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);
        const watcher = new SubprocessTreeWatcher();
        const seen: unknown[] = [];
        watcher.watchTree("/repo", OPTIONS, (changes) => seen.push(changes));

        child.emit("message", { t: "changes", id: 1, changes: [{ type: "created", path: "/repo/a.ts" }] });

        expect(seen).toEqual([[{ type: "created", path: "/repo/a.ts" }]]);
    });

    it("смерть ребёнка видна хосту: живой запрос переподписывается на новый процесс", () => {
        const first = new FakeChild();
        const second = new FakeChild();
        spawnMock.mockReturnValueOnce(first as never).mockReturnValueOnce(second as never);
        const watcher = new SubprocessTreeWatcher();
        watcher.watchTree("/repo", OPTIONS, () => undefined);

        first.emit("exit", 1, null);

        expect(second.sent).toEqual([{ t: "watch", id: 1, rootPath: "/repo", options: OPTIONS }]);
    });

    it("dispose снимает ребёнка сигналом — сироты у заблокированного супервизора не остаётся", () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);
        const watcher = new SubprocessTreeWatcher();
        watcher.watchTree("/repo", OPTIONS, () => undefined);

        watcher.dispose();

        expect(child.signals).toEqual(["SIGKILL"]);
    });

    it("отправка в закрытый канал не выпускает исключение наружу", () => {
        const child = new FakeChild(true);
        spawnMock.mockReturnValue(child as never);
        const watcher = new SubprocessTreeWatcher();

        expect(() => watcher.watchTree("/repo", OPTIONS, () => undefined)).not.toThrow();
    });

    it("stderr ребёнка (падение с трассой) уходит в канал files.watcher", () => {
        const { logService, entries } = createLogService();
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);
        const watcher = new SubprocessTreeWatcher({ logger: logService.createLogger("files.watcher") });
        watcher.watchTree("/repo", OPTIONS, () => undefined);

        child.stderr.emit("data", "TypeError: boom\n");

        const entry = entries.at(-1);
        expect(entry?.channel).toBe("files.watcher");
        expect(entry?.level).toBe(LogLevel.Warn);
        expect(entry?.message).toContain("TypeError: boom");
    });
});
