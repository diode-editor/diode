import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { IProtocolMessage } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHostProcess, type IExtensionHostProcessOptions } from "./extensionHostProcess.ts";

// Настоящий процесс не нужен: проверяем, КАК его запускают и что делают с его
// потоками, сигналами и событиями.
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const { spawn } = await import("node:child_process");
const spawnMock = vi.mocked(spawn);

class FakeChild extends EventEmitter {
    public exitCode: number | null = null;
    public killed = false;
    public stdout: PassThrough | null = null;
    public stderr: PassThrough | null = null;
    public readonly sent: IProtocolMessage[] = [];
    public readonly signals: string[] = [];
    /** Выходит по этому сигналу; на `host.shutdown` не отвечает. */
    public exitOnSignal: string | null = null;
    /** Через сколько мс после сигнала ребёнок действительно выходит. */
    public exitDelayMs = 0;

    public send(message: IProtocolMessage): boolean {
        this.sent.push(message);
        return true;
    }

    public kill(signal?: string): boolean {
        const sig = signal ?? "SIGTERM";
        this.signals.push(sig);
        this.killed = true;
        if (sig === this.exitOnSignal) {
            const exit = (): void => {
                this.exitCode = 0;
                this.emit("exit", 0, sig);
            };
            if (this.exitDelayMs === 0) exit();
            else setTimeout(exit, this.exitDelayMs);
        }
        return true;
    }
}

function logger() {
    return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), isEnabled: () => true };
}

function start(child: FakeChild, overrides: Partial<IExtensionHostProcessOptions> = {}, onExit = vi.fn()) {
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
    it("с логгерами stdout/stderr идут в pipe, без них — наследуются", () => {
        start(new FakeChild(), { stdoutLogger: logger(), stderrLogger: logger() });
        start(new FakeChild());

        expect(spawnMock.mock.calls.map((call) => (call[2] as { stdio: unknown }).stdio)).toEqual([
            ["ignore", "pipe", "pipe", "ipc"],
            ["ignore", "inherit", "inherit", "ipc"],
        ]);
    });

    it("без своего env ребёнок получает окружение родителя и метку роли", () => {
        start(new FakeChild());
        start(new FakeChild(), { spawnArgs: () => ({ command: "node", args: [], env: { ONLY: "this" } }) });

        const [inherited, explicit] = spawnMock.mock.calls.map((call) => (call[2] as { env: NodeJS.ProcessEnv }).env);
        expect(inherited).toEqual({ ...process.env, DIODE_EXTENSION_HOST: "1" });
        expect(explicit).toEqual({ ONLY: "this" });
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

    it("выход ребёнка доходит до владельца с кодом и сигналом", () => {
        const child = new FakeChild();
        const { onExit } = start(child);

        child.emit("exit", 3, "SIGTERM");

        expect(onExit).toHaveBeenCalledExactlyOnceWith(3, "SIGTERM");
    });
});

describe("ExtensionHostProcess — потоки ребёнка", () => {
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
        expect(child.signals).toEqual(["SIGTERM"]);
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

        await expect(subprocess.rpc.request("host.ping")).rejects.toThrow("RpcEndpoint disposed");
    });

    it("kill добивает ребёнка SIGKILL синхронно", () => {
        const child = new FakeChild();
        const { subprocess } = start(child);

        subprocess.kill();

        expect(child.signals).toEqual(["SIGKILL"]);
    });
});
