import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IProtocolMessage } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHostProcess, type IExtensionHostProcessOptions } from "./extensionHostProcess.ts";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const { spawn } = await import("node:child_process");
const spawnMock = vi.mocked(spawn);

class FakeChild extends EventEmitter {
    /** Needed to address the process GROUP. */
    public pid: number | undefined = 4242;
    public exitCode: number | null = null;
    public signalCode: string | null = null;
    public killed = false;
    public stdout: PassThrough | null = null;
    public stderr: PassThrough | null = null;
    public readonly sent: IProtocolMessage[] = [];
    public readonly signals: string[] = [];
    /** `process.kill(-pid)`: the grandchildren path. */
    public readonly groupSignals: string[] = [];
    public exitOnSignal: string | null = null;
    public exitDelayMs = 0;

    public send(message: IProtocolMessage): boolean {
        this.sent.push(message);
        return true;
    }

    public signalGroup(signal: string): void {
        this.groupSignals.push(signal);
        this.receive(signal);
    }

    public kill(signal?: string): boolean {
        const sig = signal ?? "SIGTERM";
        this.signals.push(sig);
        // Set even when the child survives the signal, as in node.
        this.killed = true;
        this.receive(sig);
        return true;
    }

    private receive(sig: string): void {
        if (sig === this.exitOnSignal) {
            // Killed by a signal: node leaves `exitCode` null and fills `signalCode`.
            const exit = (): void => {
                this.signalCode = sig;
                this.emit("exit", null, sig);
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
 * `process.kill(-pid, …)` addresses the group; here it is delivered to the child with that pid, otherwise
 * escalation wouldn't progress.
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

describe("ExtensionHostProcess — start", () => {
    it("with loggers stdout/stderr are piped, without them they are closed rather than inherited (the terminal is shared with the editor)", () => {
        start(new FakeChild(), { stdoutLogger: logger(), stderrLogger: logger() });
        start(new FakeChild());

        expect(spawnMock.mock.calls.map((call) => (call[2] as { stdio: unknown }).stdio)).toEqual([
            ["ignore", "pipe", "pipe", "ipc"],
            ["ignore", "ignore", "ignore", "ipc"],
        ]);
    });

    it("without its own env the child gets the parent's environment and the role marker", () => {
        start(new FakeChild());
        start(new FakeChild(), { spawnArgs: () => ({ command: "node", args: [], env: { ONLY: "this" } }) });

        const [inherited, explicit] = spawnMock.mock.calls.map((call) => (call[2] as { env: NodeJS.ProcessEnv }).env);
        expect(inherited).toEqual({ ...process.env, DIODE_EXTENSION_HOST: "1" });
        expect(explicit).toEqual({ ONLY: "this", DIODE_EXTENSION_HOST: "1" });
    });

    it("a stream without a logger is not listened to, and an error without a logger crashes nothing", () => {
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

    it("a failed spawn (error without exit) is an end for the owner too, exactly once", () => {
        const log = logger();
        const child = new FakeChild();
        const { onExit } = start(child, { logger: log });

        child.emit("error", Object.assign(new Error("spawn EMFILE"), { code: "EMFILE" }));
        // A closed channel emits an error on every send.
        child.emit("error", new Error("ERR_IPC_CHANNEL_CLOSED"));

        expect(onExit).toHaveBeenCalledExactlyOnceWith(null, null);
        expect(log.error).toHaveBeenCalledWith("extension host subprocess error", expect.any(Error));
    });

    it("a broken child stream logs a warning to the host log with the process label", () => {
        const log = logger();
        const child = new FakeChild();
        child.stdout = new PassThrough();
        start(child, { logger: log, stdoutLogger: logger() });

        child.stdout.emit("error", new Error("EPIPE"));

        expect(log.warn).toHaveBeenCalledWith("[extension-host] stdout stream error: Error: EPIPE");
    });

    it("waiting for host.ready rejects right away on a failed spawn, not on timeout", async () => {
        const child = new FakeChild();
        const { subprocess } = start(child);
        const ready = subprocess.waitForReady(60_000);

        child.emit("error", new Error("spawn ENOENT"));

        await expect(ready).rejects.toThrow(/exited before ready/);
    });

    it("the child's exit reaches the owner with code and signal", () => {
        const child = new FakeChild();
        const { onExit } = start(child);

        child.emit("exit", 3, "SIGTERM");

        expect(onExit).toHaveBeenCalledExactlyOnceWith(3, "SIGTERM");
    });
});

describe("ExtensionHostProcess — child streams", () => {
    it("stdout to info, stderr to warn, line by line, empty lines skipped", async () => {
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

    it("a multibyte character split across chunks arrives whole", () => {
        const child = new FakeChild();
        child.stdout = new PassThrough();
        const out = logger();
        start(child, { stdoutLogger: out });

        // A Cyrillic letter is two bytes in utf8; split between them.
        child.stdout.write(Buffer.from([0xd1]));
        child.stdout.write(Buffer.from([0x91, 0x0a]));

        return new Promise<void>((resolve) => {
            setImmediate(() => {
                expect(out.info).toHaveBeenCalledExactlyOnceWith("\u0451"); // "yo"
                resolve();
            });
        });
    });
});

describe("ExtensionHostProcess — shutdown", () => {
    it("a child silent on host.shutdown gets SIGTERM, and shutdown waits for the exit", async () => {
        const child = new FakeChild();
        child.exitOnSignal = "SIGTERM";
        const { subprocess } = start(child);

        await subprocess.shutdown(10);

        expect(child.sent.some((m) => m.kind === "req" && m.method === "host.shutdown")).toBe(true);
        expect(child.groupSignals).toEqual(["SIGTERM"]);
    });

    it("a child that exits some time after the signal is waited for", async () => {
        const child = new FakeChild();
        child.exitOnSignal = "SIGTERM";
        child.exitDelayMs = 30;
        const { subprocess } = start(child);

        await subprocess.shutdown(10);

        expect(child.signalCode).toBe("SIGTERM");
        expect(child.groupSignals).toEqual(["SIGTERM"]);
    });

    it("a child that exited with a code after host.shutdown gets no signal", async () => {
        const child = new FakeChild();
        const { subprocess } = start(child);
        child.exitCode = 0;

        await subprocess.shutdown(1);

        expect(child.groupSignals).toEqual([]);
        expect(child.signals).toEqual([]);
    });

    // The direct `kill` sets `child.killed` for a surviving child too: on win32 it is the only path,
    // elsewhere it is the fallback after a failed group kill.
    it("a direct kill escalates to SIGKILL when the child survives SIGTERM", async () => {
        vi.mocked(process.kill).mockImplementation(() => {
            throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
        });
        const child = new FakeChild();
        child.exitOnSignal = "SIGKILL";
        const { subprocess } = start(child);

        await subprocess.shutdown(1);

        expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    });

    it("after shutdown the channel is closed: a request is rejected rather than lost", async () => {
        const child = new FakeChild();
        child.exitOnSignal = "SIGTERM";
        const { subprocess } = start(child);

        await subprocess.shutdown(10);

        await expect(subprocess.rpc.request("host.shutdown")).rejects.toThrow("RpcEndpoint disposed");
    });

    it("kill finishes the child off with SIGKILL synchronously", () => {
        const child = new FakeChild();
        child.pid = undefined; // no pid means no group, only a direct kill remains
        const { subprocess } = start(child);

        subprocess.kill();

        expect(child.signals).toEqual(["SIGKILL"]);
    });
});

/**
 * Grandchildren are extensions' language servers (jdtls, gopls): a signal to the direct child doesn't reach them, and
 * outliving the parent they keep writing into extension directories. Hence the signal targets the GROUP.
 */
describe("ExtensionHostProcess — subprocess descendants", () => {
    it.skipIf(process.platform === "win32")("the subprocess starts as its own process group leader", () => {
        start(new FakeChild());

        expect((spawnMock.mock.calls[0]?.[2] as { detached: unknown }).detached).toBe(true);
    });

    it.skipIf(process.platform === "win32")("the signal goes to the GROUP, not to the single child", async () => {
        const child = new FakeChild(); // dies from nothing, so we go through the whole escalation
        const { subprocess } = start(child);

        await subprocess.shutdown(1);

        expect(child.groupSignals).toEqual(["SIGTERM", "SIGKILL"]);
        expect(child.signals).toEqual([]);
    });

    it.skipIf(process.platform === "win32")(
        "the group is already gone (ESRCH): no crash and no duplicate signal",
        () => {
            // Not registered in `spawned` → the `process.kill` mock returns ESRCH, as the kernel does for a missing group.
            const child = new FakeChild();
            child.pid = undefined;
            const { subprocess } = start(child);
            child.pid = 9999;

            expect(() => {
                subprocess.kill();
            }).not.toThrow();
            expect(child.signals).toEqual([]);
            expect(child.groupSignals).toEqual([]);
        },
    );

    it.skipIf(process.platform === "win32")(
        "the group kill fails with something other than ESRCH: the child is killed directly",
        () => {
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
        },
    );

    it.skipIf(process.platform === "win32")("a failed group kill without a logger does not crash shutdown", () => {
        vi.mocked(process.kill).mockImplementation(() => {
            throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
        });
        const child = new FakeChild();
        const { subprocess } = start(child); // no logger: the `logger?.warn` path

        expect(() => {
            subprocess.kill();
        }).not.toThrow();
        expect(child.signals).toEqual(["SIGKILL"]);
    });
});
