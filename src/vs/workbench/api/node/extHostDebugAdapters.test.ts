import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough, type Readable, type Writable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { settle, waitUntil } from "../../../../TestUtils/timing.ts";
import {
    DebugAdapterExecutable,
    DebugAdapterInlineImplementation,
    DebugAdapterNamedPipeServer,
    DebugAdapterServer,
} from "../common/debugTypes.ts";
import type { ExtHostDebugAdapter } from "../common/extHostDebugAdapter.ts";

import {
    createNodeDebugAdapter,
    ExecutableDebugAdapter,
    NamedPipeDebugAdapter,
    SocketDebugAdapter,
    StreamDebugAdapter,
} from "./extHostDebugAdapters.ts";

const ADAPTER_PROCESS = path.join(
    import.meta.dirname,
    "../../services/extensions/node/__fixtures__/debugAdapters/adapterProcess.cjs",
);

const frame = (message: object): string => {
    const json = JSON.stringify(message);
    return `Content-Length: ${String(Buffer.byteLength(json, "utf8"))}\r\n\r\n${json}`;
};

const initialize = { seq: 1, type: "request", command: "initialize" } as DebugProtocol.Request;

function record(adapter: ExtHostDebugAdapter) {
    const seen = { messages: [] as DebugProtocol.ProtocolMessage[], errors: [] as string[], exits: [] as unknown[] };
    adapter.onMessage((m) => seen.messages.push(m));
    adapter.onError((e) => seen.errors.push(e.message));
    adapter.onExit((code) => seen.exits.push(code));
    return seen;
}

const cleanup: (() => void)[] = [];
afterEach(() => {
    for (const clean of cleanup.splice(0)) clean();
});

class PipeAdapter extends StreamDebugAdapter {
    public readonly incoming = new PassThrough();
    public readonly outgoing = new PassThrough();

    public startSession(): Promise<void> {
        this.connect(this.incoming, this.outgoing);
        return Promise.resolve();
    }

    public stopSession(): Promise<void> {
        return Promise.resolve();
    }
}

describe("StreamDebugAdapter — the DAP base protocol, as upstream's", () => {
    it("frames outgoing messages with their byte length", async () => {
        const adapter = new PipeAdapter();
        cleanup.push(() => {
            adapter.dispose();
        });
        adapter.sendMessage(initialize); // before the connection: dropped
        await adapter.startSession();
        const message = { seq: 2, type: "event", event: "output", body: { output: "ü" } } as DebugProtocol.Event;
        adapter.sendMessage(message);
        expect(String(adapter.outgoing.read())).toBe(frame(message));
    });

    it("splits incoming data into messages: headers and bodies across chunks, several in one chunk, any header case of separators", async () => {
        const adapter = new PipeAdapter();
        cleanup.push(() => {
            adapter.dispose();
        });
        const seen = record(adapter);
        await adapter.startSession();
        const a = { seq: 1, type: "event", event: "a" };
        const b = { seq: 2, type: "event", event: "b", body: { text: "ä" } };
        const c = { seq: 3, type: "event", event: "c" };
        const whole = frame(a) + frame(b);
        adapter.incoming.write(whole.slice(0, 10));
        adapter.incoming.write(whole.slice(10, whole.length - 3));
        adapter.incoming.write(whole.slice(whole.length - 3));
        // A non-RFC line separator and an extra header; an empty body is skipped.
        const json = JSON.stringify(c);
        adapter.incoming.write(`X-Other: 1\nContent-Length:${String(json.length)}\nX-After: 2\r\n\r\n${json}`);
        adapter.incoming.write("Content-Length: 0\r\n\r\n");
        await waitUntil("three messages", () => seen.messages.length === 3);
        expect(seen.messages).toEqual([a, b, c]);
        expect(seen.errors).toEqual([]);
    });

    it("a body that is not JSON is an error with the body; the next message still arrives", async () => {
        const adapter = new PipeAdapter();
        cleanup.push(() => {
            adapter.dispose();
        });
        const seen = record(adapter);
        await adapter.startSession();
        adapter.incoming.write("Content-Length: 3\r\n\r\n{x}" + frame({ seq: 1, type: "event", event: "a" }));
        await waitUntil("the message", () => seen.messages.length === 1);
        expect(seen.errors).toEqual([expect.stringMatching(/JSON[\s\S]*\n\{x\}$/)]);
    });
});

describe("SocketDebugAdapter and NamedPipeDebugAdapter", () => {
    async function echoServer(listen: (server: net.Server) => Promise<void>): Promise<net.Socket[]> {
        const sockets: net.Socket[] = [];
        const server = net.createServer((socket) => {
            sockets.push(socket);
            socket.on("data", (data) => socket.write(data));
        });
        await listen(server);
        cleanup.push(() => {
            for (const socket of sockets) socket.destroy();
            server.close();
        });
        return sockets;
    }

    it("a TCP adapter connects, messages go both ways; a close by the adapter is an error; stop ends the socket", async () => {
        let port = 0;
        const sockets = await echoServer(
            (server) =>
                new Promise((resolve) => {
                    server.listen(0, "127.0.0.1", () => {
                        port = (server.address() as net.AddressInfo).port;
                        resolve();
                    });
                }),
        );
        const adapter = new SocketDebugAdapter(new DebugAdapterServer(port));
        cleanup.push(() => {
            adapter.dispose();
        });
        const seen = record(adapter);
        await adapter.startSession();
        adapter.sendMessage(initialize);
        await waitUntil("the echo", () => seen.messages.length === 1);
        expect(seen.messages).toEqual([initialize]);

        sockets[0].destroy();
        await waitUntil("the close", () => seen.errors.length > 0);
        expect(seen.errors).toContain("connection closed");
        await adapter.stopSession();
    });

    it("a TCP adapter that refuses the connection fails the start", async () => {
        const server = net.createServer();
        const port = await new Promise<number>((resolve) => {
            server.listen(0, "127.0.0.1", () => {
                resolve((server.address() as net.AddressInfo).port);
            });
        });
        await new Promise((resolve) => server.close(resolve));
        const adapter = new SocketDebugAdapter(new DebugAdapterServer(port, "127.0.0.1"));
        cleanup.push(() => {
            adapter.dispose();
        });
        const seen = record(adapter);
        await expect(adapter.startSession()).rejects.toThrow(/ECONNREFUSED/);
        await settle(10);
        // The start's failure is all: no session ran, so the close that follows is no error of one.
        expect(seen.errors).toEqual([]);
    });

    it("an AggregateError of the connect (ipv6 posix) fails the start with its first error; a later socket error is the adapter's", async () => {
        const server = net.createServer();
        const port = await new Promise<number>((resolve) => {
            server.listen(0, "127.0.0.1", () => {
                resolve((server.address() as net.AddressInfo).port);
            });
        });
        cleanup.push(() => {
            server.close();
        });
        const socketOf = (adapter: SocketDebugAdapter): net.Socket =>
            (adapter as unknown as { socket: net.Socket }).socket;

        const failing = new SocketDebugAdapter(new DebugAdapterServer(port));
        cleanup.push(() => {
            failing.dispose();
        });
        const started = failing.startSession();
        socketOf(failing).destroy(new AggregateError([new Error("first"), new Error("second")]));
        await expect(started).rejects.toEqual(new Error("first"));

        const connected = new SocketDebugAdapter(new DebugAdapterServer(port));
        cleanup.push(() => {
            connected.dispose();
        });
        const seen = record(connected);
        await connected.startSession();
        socketOf(connected).destroy(new Error("reset"));
        await waitUntil("the error", () => seen.errors.includes("reset"));
    });

    it("a named pipe adapter connects to its path; stop ends the connection and the adapter sees no error", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-pipe-"));
        cleanup.push(() => {
            fs.rmSync(dir, { recursive: true, force: true });
        });
        const pipe = path.join(dir, "dap.sock");
        const sockets = await echoServer(
            (server) =>
                new Promise((resolve) => {
                    server.listen(pipe, resolve);
                }),
        );
        const adapter = new NamedPipeDebugAdapter(new DebugAdapterNamedPipeServer(pipe));
        cleanup.push(() => {
            adapter.dispose();
        });
        const seen = record(adapter);
        await adapter.startSession();
        adapter.sendMessage(initialize);
        await waitUntil("the echo", () => seen.messages.length === 1);
        await adapter.stopSession();
        await adapter.stopSession();
        await waitUntil("the server sees the end", () => sockets[0].readableEnded);
    });

    it("a missing pipe fails the start", async () => {
        const adapter = new NamedPipeDebugAdapter(new DebugAdapterNamedPipeServer("/nonexistent/diode.sock"));
        cleanup.push(() => {
            adapter.dispose();
        });
        await expect(adapter.startSession()).rejects.toThrow(/ENOENT/);
    });
});

describe("ExecutableDebugAdapter", () => {
    const launch = { seq: 2, type: "request", command: "launch", arguments: {} } as DebugProtocol.Request;

    it("a process adapter speaks DAP over stdio; options.env and cwd reach it; stop terminates it", async () => {
        const adapter = new ExecutableDebugAdapter(
            new DebugAdapterExecutable(process.execPath, [ADAPTER_PROCESS, "spawned"], {
                env: { DIODE_TEST_DAP: "1" },
                cwd: os.tmpdir(),
            }),
            "t",
        );
        cleanup.push(() => {
            adapter.dispose();
        });
        const seen = record(adapter);
        await adapter.startSession();
        adapter.sendMessage(initialize);
        await waitUntil("the response", () => seen.messages.length === 1);
        expect(seen.messages[0]).toMatchObject({
            type: "response",
            command: "initialize",
            success: true,
            body: { env: "1", cwd: fs.realpathSync(os.tmpdir()) },
        });

        await adapter.stopSession();
        await waitUntil("the exit", () => seen.exits.length === 1);
        expect(seen.exits).toEqual([null]);
    });

    it("`node` is forked with the rest of the arguments; the exit code of a crash is reported", async () => {
        const adapter = new ExecutableDebugAdapter(
            new DebugAdapterExecutable("node", [ADAPTER_PROCESS, "forked"], { env: {}, cwd: undefined }),
            "t",
        );
        cleanup.push(() => {
            adapter.dispose();
        });
        const seen = record(adapter);
        await adapter.startSession();
        adapter.sendMessage(initialize);
        await waitUntil("the response", () => seen.messages.length === 1);
        // The rest of the arguments reach the script; no variables of its own: the subprocess's environment and folder.
        expect((seen.messages[0] as DebugProtocol.Response).body).toMatchObject({ name: "forked" });
        const body: unknown = (seen.messages[0] as DebugProtocol.Response).body;
        expect(body).toMatchObject({ cwd: process.cwd() });
        expect(body).not.toHaveProperty("env");
        adapter.sendMessage({ ...launch, arguments: { crash: true } } as DebugProtocol.Request);
        adapter.sendMessage({ seq: 3, type: "request", command: "configurationDone" } as DebugProtocol.Request);
        await waitUntil("the exit", () => seen.exits.length === 1);
        expect(seen.exits).toEqual([3]);
        expect(seen.errors).toContain("read error");
    });

    it("what is wrong before the spawn fails the start: no command, a missing file, `node` without a script", async () => {
        const cases: [DebugAdapterExecutable, Error][] = [
            [new DebugAdapterExecutable(""), new Error("Cannot determine executable for debug adapter 't'.")],
            [
                new DebugAdapterExecutable("/nonexistent/adapter"),
                new Error("Debug adapter executable '/nonexistent/adapter' does not exist."),
            ],
            [new DebugAdapterExecutable("node"), new Error("Unable to launch debug adapter.")],
        ];
        for (const [executable, error] of cases) {
            const adapter = new ExecutableDebugAdapter(executable, "t");
            cleanup.push(() => {
                adapter.dispose();
            });
            await expect(adapter.startSession()).rejects.toEqual(error);
        }
    });

    it("a spawn that fails (a command not on PATH) is the adapter's error, as upstream's", async () => {
        const adapter = new ExecutableDebugAdapter(new DebugAdapterExecutable("diode-no-such-adapter"), "t");
        cleanup.push(() => {
            adapter.dispose();
        });
        const seen = record(adapter);
        await adapter.startSession();
        await waitUntil("the error", () => seen.errors.length > 0);
        expect(seen.errors[0]).toMatch(/ENOENT/);
    });

    it("its stderr is drained: an adapter that writes a lot there still answers", async () => {
        const adapter = new ExecutableDebugAdapter(
            new DebugAdapterExecutable(process.execPath, [ADAPTER_PROCESS], { env: { DIODE_TEST_DAP_STDERR: "1024" } }),
            "t",
        );
        cleanup.push(() => {
            adapter.dispose();
        });
        const seen = record(adapter);
        await adapter.startSession();
        adapter.sendMessage(initialize);
        await waitUntil("the response", () => seen.messages.length === 1, 10_000);
        await adapter.stopSession();
    });

    it("dispose kills the process", async () => {
        const adapter = new ExecutableDebugAdapter(new DebugAdapterExecutable("node", [ADAPTER_PROCESS]), "t");
        await adapter.startSession();
        const { child } = adapter as unknown as { child: { killed: boolean; signalCode: string | null } };
        adapter.dispose();
        expect(child.killed).toBe(true);
    });

    it("errors of the process's streams are the adapter's errors", async () => {
        const adapter = new ExecutableDebugAdapter(new DebugAdapterExecutable("node", [ADAPTER_PROCESS]), "t");
        cleanup.push(() => {
            adapter.dispose();
        });
        const seen = record(adapter);
        await adapter.startSession();
        const { stdin, stdout } = (adapter as unknown as { child: { stdin: Writable; stdout: Readable } }).child;
        stdout.emit("error", new Error("stdout broke"));
        stdin.emit("error", new Error("stdin broke"));
        expect(seen.errors).toEqual(["stdout broke", "stdin broke"]);
        await adapter.stopSession();
    });

    it("stop before a start does nothing", async () => {
        const adapter = new ExecutableDebugAdapter(new DebugAdapterExecutable("node", [ADAPTER_PROCESS]), "t");
        await expect(adapter.stopSession()).resolves.toBeUndefined();
        adapter.dispose();
    });
});

describe("createNodeDebugAdapter", () => {
    it("makes the adapter of each OS descriptor; an inline one is not its business", () => {
        const made = [
            createNodeDebugAdapter(new DebugAdapterExecutable("node"), "t"),
            createNodeDebugAdapter(new DebugAdapterServer(1), "t"),
            createNodeDebugAdapter(new DebugAdapterNamedPipeServer("/p"), "t"),
        ];
        expect(made.map((adapter) => adapter?.constructor)).toEqual([
            ExecutableDebugAdapter,
            SocketDebugAdapter,
            NamedPipeDebugAdapter,
        ]);
        expect(createNodeDebugAdapter(new DebugAdapterInlineImplementation({} as never), "t")).toBeUndefined();
    });
});
