import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IProtocolMessage } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHostProcess, type IExtensionHostProcessOptions } from "./extensionHostProcess.ts";

// Настоящий процесс не нужен: проверяем, КАК его запускают и что делают с его
// потоками, сигналами и событиями.
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const { spawn } = await import("node:child_process");
const spawnMock = vi.mocked(spawn);

class FakeChild extends EventEmitter {
    /** Как у настоящего ChildProcess: нужен для адресации ГРУППЫ процессов. */
    public pid: number | undefined = 4242;
    public exitCode: number | null = null;
    public killed = false;
    public stdout: PassThrough | null = null;
    public stderr: PassThrough | null = null;
    public readonly sent: IProtocolMessage[] = [];
    /** Сигналы, пришедшие прямо ребёнку (`child.kill`). */
    public readonly signals: string[] = [];
    /** Сигналы, пришедшие ГРУППЕ (`process.kill(-pid)`) — путь внуков. */
    public readonly groupSignals: string[] = [];
    /** Выходит по этому сигналу; на `host.shutdown` не отвечает. */
    public exitOnSignal: string | null = null;
    /** Через сколько мс после сигнала ребёнок действительно выходит. */
    public exitDelayMs = 0;

    public send(message: IProtocolMessage): boolean {
        this.sent.push(message);
        return true;
    }

    /** Сигнал группе: доходит до ребёнка так же, как прямой. */
    public signalGroup(signal: string): void {
        this.groupSignals.push(signal);
        this.receive(signal);
    }

    public kill(signal?: string): boolean {
        const sig = signal ?? "SIGTERM";
        this.signals.push(sig);
        // Как у настоящего ChildProcess: флаг ставит только собственный kill.
        // Групповой `process.kill(-pid)` его НЕ выставляет — иначе эскалация
        // сигналов остановилась бы на первом шаге.
        this.killed = true;
        this.receive(sig);
        return true;
    }

    private receive(sig: string): void {
        if (sig === this.exitOnSignal) {
            const exit = (): void => {
                this.exitCode = 0;
                this.emit("exit", 0, sig);
            };
            if (this.exitDelayMs === 0) exit();
            else setTimeout(exit, this.exitDelayMs);
        }
    }
}

function logger() {
    return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), isEnabled: () => true };
}

/**
 * Живые `FakeChild` этого кейса, по pid. `process.kill(-pid, …)` настоящего
 * кода адресует группу — здесь он доставляется ребёнку с этим pid, иначе
 * эскалация сигналов в тесте ничего бы не двигала.
 */
const spawned = new Map<number, FakeChild>();

beforeEach(() => {
    vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: string | number) => {
        const target = pid < 0 ? spawned.get(-pid) : spawned.get(pid);
        if (target === undefined) {
            throw Object.assign(new Error("no such process"), { code: "ESRCH" });
        }
        target.signalGroup(typeof signal === "string" ? signal : "SIGTERM");
        return true;
    }) as typeof process.kill);
});

afterEach(() => {
    vi.mocked(process.kill).mockRestore();
    spawned.clear();
});

function start(child: FakeChild, overrides: Partial<IExtensionHostProcessOptions> = {}, onExit = vi.fn()) {
    if (child.pid !== undefined) spawned.set(child.pid, child);
    spawnMock.mockReturnValue(child as never);
    const subprocess = new ExtensionHostProcess(
        {
            spawnArgs: () => ({ command: "node", args: ["host.js"] }),
            logger: undefined,
            rpcLogger: undefined,
            stdoutLogger: undefined,
            stderrLogger: undefined,
            ...overrides,
        },
        onExit,
    );
    return { subprocess, onExit };
}

afterEach(() => {
    spawnMock.mockReset();
});

describe("ExtensionHostProcess — запуск", () => {
    it("с логгерами stdout/stderr идут в pipe, без них — закрыты, а не наследуются (терминал общий с редактором)", () => {
        start(new FakeChild(), { stdoutLogger: logger(), stderrLogger: logger() });
        start(new FakeChild());

        expect(spawnMock.mock.calls.map((call) => (call[2] as { stdio: unknown }).stdio)).toEqual([
            ["ignore", "pipe", "pipe", "ipc"],
            ["ignore", "ignore", "ignore", "ipc"],
        ]);
    });

    it("без своего env ребёнок получает окружение родителя и метку роли", () => {
        start(new FakeChild());
        start(new FakeChild(), { spawnArgs: () => ({ command: "node", args: [], env: { ONLY: "this" } }) });

        const [inherited, explicit] = spawnMock.mock.calls.map((call) => (call[2] as { env: NodeJS.ProcessEnv }).env);
        expect(inherited).toEqual({ ...process.env, DIODE_EXTENSION_HOST: "1" });
        // Своё окружение шва — тоже с меткой роли: без неё ребёнок не узнал бы, кем он запущен.
        expect(explicit).toEqual({ ONLY: "this", DIODE_EXTENSION_HOST: "1" });
    });

    it("поток без логгера не слушается, ошибка без логгера не роняет", () => {
        const child = new FakeChild();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        start(child);

        expect(() => {
            child.stdout?.emit("data", "line\n");
            child.stderr?.emit("data", "line\n");
            child.emit("error", new Error("EMFILE"));
        }).not.toThrow();
    });

    it("неудачный спавн (error без exit) — тоже конец для владельца, ровно один", () => {
        const log = logger();
        const child = new FakeChild();
        const { onExit } = start(child, { logger: log });

        child.emit("error", Object.assign(new Error("spawn EMFILE"), { code: "EMFILE" }));
        // Закрытый канал эмитит ошибку на каждый send — вторая не роняет и не дублирует конец.
        child.emit("error", new Error("ERR_IPC_CHANNEL_CLOSED"));

        expect(onExit).toHaveBeenCalledExactlyOnceWith(null, null);
        expect(log.error).toHaveBeenCalledWith("extension host subprocess error", expect.any(Error));
    });

    it("сломавшийся поток ребёнка — предупреждение в лог host'а с меткой процесса", () => {
        const log = logger();
        const child = new FakeChild();
        child.stdout = new PassThrough();
        start(child, { logger: log, stdoutLogger: logger() });

        child.stdout.emit("error", new Error("EPIPE"));

        expect(log.warn).toHaveBeenCalledWith("[extension-host] stdout stream error: Error: EPIPE");
    });

    it("ожидание host.ready отвергается сразу на неудачном спавне, а не по таймауту", async () => {
        const child = new FakeChild();
        const { subprocess } = start(child);
        const ready = subprocess.waitForReady(60_000);

        child.emit("error", new Error("spawn ENOENT"));

        await expect(ready).rejects.toThrow(/exited before ready/);
    });

    it("выход ребёнка доходит до владельца с кодом и сигналом", () => {
        const child = new FakeChild();
        const { onExit } = start(child);

        child.emit("exit", 3, "SIGTERM");

        expect(onExit).toHaveBeenCalledExactlyOnceWith(3, "SIGTERM");
    });
});

describe("ExtensionHostProcess — потоки ребёнка", () => {
    it("stdout в info, stderr в warn — построчно, пустые строки пропускаются", async () => {
        const child = new FakeChild();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        const out = logger();
        const err = logger();
        start(child, { stdoutLogger: out, stderrLogger: err });

        child.stdout.end("one\n\ntwo\n");
        child.stderr.end("warn\n\n");
        await new Promise((resolve) => setImmediate(resolve));

        expect(out.info.mock.calls).toEqual([["one"], ["two"]]);
        expect(err.warn.mock.calls).toEqual([["warn"]]);
    });

    it("многобайтный символ, разрезанный между чанками, приходит целым", () => {
        const child = new FakeChild();
        child.stdout = new PassThrough();
        const out = logger();
        start(child, { stdoutLogger: out });

        // «ё» в utf8 — два байта; режем между ними.
        child.stdout.write(Buffer.from([0xd1]));
        child.stdout.write(Buffer.from([0x91, 0x0a]));

        return new Promise<void>((resolve) => {
            setImmediate(() => {
                expect(out.info).toHaveBeenCalledExactlyOnceWith("ё");
                resolve();
            });
        });
    });
});

describe("ExtensionHostProcess — выключение", () => {
    it("ребёнок молчит на host.shutdown — SIGTERM, и выключение дожидается выхода", async () => {
        const child = new FakeChild();
        child.exitOnSignal = "SIGTERM";
        const { subprocess } = start(child);

        await subprocess.shutdown(10);

        expect(child.sent.some((m) => m.kind === "req" && m.method === "host.shutdown")).toBe(true);
        // Сигнал адресован ГРУППЕ — вместе с ребёнком уходят и его внуки.
        expect(child.groupSignals).toEqual(["SIGTERM"]);
    });

    it("ребёнок выходит не сразу после сигнала — выключение его дожидается", async () => {
        const child = new FakeChild();
        child.exitOnSignal = "SIGTERM";
        child.exitDelayMs = 30;
        const { subprocess } = start(child);

        await subprocess.shutdown(10);

        expect(child.exitCode).toBe(0);
    });

    it("после выключения канал закрыт: запрос отклоняется, а не уходит в никуда", async () => {
        const child = new FakeChild();
        child.exitOnSignal = "SIGTERM";
        const { subprocess } = start(child);

        await subprocess.shutdown(10);

        await expect(subprocess.rpc.request("host.shutdown")).rejects.toThrow("RpcEndpoint disposed");
    });

    it("kill добивает ребёнка SIGKILL синхронно", () => {
        const child = new FakeChild();
        child.pid = undefined; // без pid группы нет — остаётся прямой kill
        const { subprocess } = start(child);

        subprocess.kill();

        expect(child.signals).toEqual(["SIGKILL"]);
    });
});

/**
 * Внуки — языковые серверы, которые поднимают сами расширения (jdtls, gopls).
 * Сигнал прямому ребёнку их не касается: пережив родителя, они продолжают
 * писать в каталоги расширения. Поэтому субпроцесс запускается лидером своей
 * группы, а сигнал адресуется ГРУППЕ.
 */
describe("ExtensionHostProcess — потомство субпроцесса", () => {
    it.skipIf(process.platform === "win32")("субпроцесс запускается лидером своей группы", () => {
        start(new FakeChild());

        expect((spawnMock.mock.calls[0]?.[2] as { detached: unknown }).detached).toBe(true);
    });

    it.skipIf(process.platform === "win32")("сигнал уходит ГРУППЕ, а не одному ребёнку", async () => {
        const child = new FakeChild(); // не умирает ни от чего — проходим всю эскалацию
        const { subprocess } = start(child);

        await subprocess.shutdown(1);

        expect(child.groupSignals).toEqual(["SIGTERM", "SIGKILL"]);
        // Прямого kill не было: группа покрывает и самого ребёнка.
        expect(child.signals).toEqual([]);
    });

    it.skipIf(process.platform === "win32")("группы уже нет (ESRCH) — не падаем и не дублируем сигнал", () => {
        // Ребёнок не зарегистрирован в `spawned` → мок `process.kill` отдаёт ESRCH,
        // как настоящее ядро для несуществующей группы.
        const child = new FakeChild();
        child.pid = undefined;
        const { subprocess } = start(child);
        child.pid = 9999;

        expect(() => {
            subprocess.kill();
        }).not.toThrow();
        expect(child.signals).toEqual([]);
        expect(child.groupSignals).toEqual([]);
    });

    it.skipIf(process.platform === "win32")("групповой kill отказал не по ESRCH — ребёнка добиваем напрямую", () => {
        const denied = Object.assign(new Error("operation not permitted"), { code: "EPERM" });
        vi.mocked(process.kill).mockImplementation(() => {
            throw denied;
        });
        const log = logger();
        const child = new FakeChild();
        const { subprocess } = start(child, { logger: log });

        subprocess.kill();

        expect(child.signals).toEqual(["SIGKILL"]);
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("group kill failed"), denied);
    });

    it.skipIf(process.platform === "win32")("отказ группового kill без логгера не роняет выключение", () => {
        vi.mocked(process.kill).mockImplementation(() => {
            throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
        });
        const child = new FakeChild();
        const { subprocess } = start(child); // логгера нет — путь `logger?.warn`

        expect(() => {
            subprocess.kill();
        }).not.toThrow();
        expect(child.signals).toEqual(["SIGKILL"]);
    });
});
