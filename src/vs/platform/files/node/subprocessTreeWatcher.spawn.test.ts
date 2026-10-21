import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { LogEntry } from "../../log/common/iLogService.ts";
import { LogLevel } from "../../log/common/logLevel.ts";
import { LogService } from "../../log/common/logService.ts";

import { SubprocessTreeWatcher } from "./subprocessTreeWatcher.ts";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const { spawn } = await import("node:child_process");
const spawnMock = vi.mocked(spawn);

class FakeChild extends EventEmitter {
    public readonly sent: unknown[] = [];
    public readonly signals: string[] = [];
    public encoding: string | null = null;
    public readonly stderr: (EventEmitter & { setEncoding: (enc: string) => void }) | null;

    public constructor(
        public readonly sendThrows = false,
        withStderr = true,
    ) {
        super();
        if (!withStderr) {
            this.stderr = null;
            return;
        }
        const stderr = new EventEmitter() as EventEmitter & { setEncoding: (enc: string) => void };
        stderr.setEncoding = (enc: string): void => {
            this.encoding = enc;
        };
        this.stderr = stderr;
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
        expect(args).toContain(process.argv[1]); // dev branch of selfSpawnArgs
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

    // An EventEmitter without an `error` listener throws right from `emit`: the tests below
    // fail exactly when there's no subscription (in production that would kill the editor).
    it("ошибка процесса не всплывает наружу, а ведёт в ту же ветку, что и смерть", () => {
        const first = new FakeChild();
        const second = new FakeChild();
        spawnMock.mockReturnValueOnce(first as never).mockReturnValueOnce(second as never);
        const watcher = new SubprocessTreeWatcher();
        watcher.watchTree("/repo", OPTIONS, () => undefined);

        expect(() => first.emit("error", Object.assign(new Error("spawn EMFILE"), { code: "EMFILE" }))).not.toThrow();

        expect(spawnMock).toHaveBeenCalledTimes(2);
        expect(second.sent).toEqual([{ t: "watch", id: 1, rootPath: "/repo", options: OPTIONS }]);
    });

    it("вторая ошибка того же канала тоже не всплывает (подписка не one-shot)", () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);
        const watcher = new SubprocessTreeWatcher();
        watcher.watchTree("/repo", OPTIONS, () => undefined);

        child.emit("error", new Error("ERR_IPC_CHANNEL_CLOSED"));

        // A closed channel emits an error on EVERY `send`, not just once.
        expect(() => child.emit("error", new Error("ERR_IPC_CHANNEL_CLOSED"))).not.toThrow();
    });

    it("сломавшийся stderr-поток не всплывает наружу", () => {
        const { logService, entries } = createLogService();
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);
        const watcher = new SubprocessTreeWatcher({ logger: logService.createLogger("files.watcher") });
        watcher.watchTree("/repo", OPTIONS, () => undefined);

        expect(() => child.stderr?.emit("error", new Error("EPIPE"))).not.toThrow();
        expect(entries.at(-1)?.message).toContain("stderr stream error");
    });

    it("сломавшийся stderr-поток без логгера тоже не всплывает", () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);
        const watcher = new SubprocessTreeWatcher();
        watcher.watchTree("/repo", OPTIONS, () => undefined);

        expect(() => child.stderr?.emit("error", new Error("EPIPE"))).not.toThrow();
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

        child.stderr?.emit("data", "TypeError: boom\n");

        const entry = entries.at(-1);
        expect(entry?.channel).toBe("files.watcher");
        expect(entry?.level).toBe(LogLevel.Warn);
        // Verbatim: the trailing newline is the log channel's job, not the entry's.
        expect(entry?.message).toBe("[file-watcher] TypeError: boom");
    });

    it("stderr читается текстом, а не буфером", () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);
        const watcher = new SubprocessTreeWatcher();

        watcher.watchTree("/repo", OPTIONS, () => undefined);

        expect(child.encoding).toBe("utf8");
    });

    it("stderr без логгера никуда не пишется и не падает", () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);
        const watcher = new SubprocessTreeWatcher();
        watcher.watchTree("/repo", OPTIONS, () => undefined);

        expect(() => child.stderr?.emit("data", "TypeError: boom\n")).not.toThrow();
    });

    it("ребёнок без stderr-потока не ломает подъём процесса", () => {
        // ChildProcess `stderr` may be `null` by type (stdio `"ignore"`);
        // spawning must not depend on whether we asked for a pipe.
        const child = new FakeChild(false, false);
        spawnMock.mockReturnValue(child as never);
        const watcher = new SubprocessTreeWatcher();

        expect(() => watcher.watchTree("/repo", OPTIONS, () => undefined)).not.toThrow();
        expect(child.sent).toHaveLength(1);
    });
});
