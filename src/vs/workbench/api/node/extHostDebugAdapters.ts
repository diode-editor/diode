import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import type { Readable, Writable } from "node:stream";

import type * as vscode from "vscode";

import { GuardedChildProcess } from "../../../base/node/childProcessGuard.ts";
import { DebugAdapterExecutable, DebugAdapterNamedPipeServer, DebugAdapterServer } from "../common/debugTypes.ts";
import { ExtHostDebugAdapter } from "../common/extHostDebugAdapter.ts";

// Upstream `contrib/debug/node/debugAdapter.ts` on the subprocess side: the DAP base protocol (a `Content-Length`
// header, an empty line, the JSON) over a process's stdio or a socket. The adapter process is guarded
// (`GuardedChildProcess`): an adapter that fails to spawn or dies is an error of its session, not of the subprocess.

const TWO_CRLF = "\r\n\r\n";
const HEADER_LINESEPARATOR = /\r?\n/; // allow for non-RFC 2822 conforming line separators
const HEADER_FIELDSEPARATOR = /: */;

/** Upstream `StreamDebugAdapter`: frames outgoing messages and splits the incoming stream into messages. */
export abstract class StreamDebugAdapter extends ExtHostDebugAdapter {
    private outputStream: Writable | undefined;
    private rawData = Buffer.alloc(0);
    private contentLength = -1;

    protected connect(readable: Readable, writable: Writable): void {
        this.outputStream = writable;
        readable.on("data", (data: Buffer) => {
            this.handleData(data);
        });
    }

    public sendMessage(message: DebugProtocol.ProtocolMessage): void {
        if (this.outputStream) {
            const json = JSON.stringify(message);
            this.outputStream.write(`Content-Length: ${String(Buffer.byteLength(json))}${TWO_CRLF}${json}`);
        }
    }

    private handleData(data: Buffer): void {
        this.rawData = Buffer.concat([this.rawData, data]);
        for (;;) {
            // An empty body (`Content-Length: 0`) is no message: its header is read past.
            if (this.contentLength > 0) {
                if (this.rawData.length < this.contentLength) return;
                const message = this.rawData.toString("utf8", 0, this.contentLength);
                this.rawData = this.rawData.subarray(this.contentLength);
                this.contentLength = -1;
                try {
                    this.onMessageEmitter.fire(JSON.parse(message) as DebugProtocol.ProtocolMessage);
                } catch (e) {
                    this.onErrorEmitter.fire(new Error(`${(e as Error).message}\n${message}`));
                }
                continue; // there may be more complete messages to process
            }
            const idx = this.rawData.indexOf(TWO_CRLF);
            if (idx === -1) return;
            const header = this.rawData.toString("utf8", 0, idx);
            for (const line of header.split(HEADER_LINESEPARATOR)) {
                const [name, value] = line.split(HEADER_FIELDSEPARATOR);
                if (name === "Content-Length") this.contentLength = Number(value);
            }
            this.rawData = this.rawData.subarray(idx + TWO_CRLF.length);
        }
    }
}

/** Upstream `NetworkDebugAdapter`: a socket; a close after the connect is an error of the session. */
abstract class NetworkDebugAdapter extends StreamDebugAdapter {
    private socket: net.Socket | undefined;

    protected abstract createConnection(connectionListener: () => void): net.Socket;

    public startSession(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            let connected = false;
            const socket = this.createConnection(() => {
                this.connect(socket, socket);
                connected = true;
                resolve();
            });
            this.socket = socket;
            // A connection that never came up fails with its `error`, which comes before the `close`.
            socket.on("close", () => {
                if (connected) this.onErrorEmitter.fire(new Error("connection closed"));
            });
            socket.on("error", (raw) => {
                // On ipv6 posix this can be an AggregateError which lacks a message. Use the first.
                const error = raw instanceof AggregateError ? (raw.errors[0] as Error) : raw;
                if (connected) {
                    this.onErrorEmitter.fire(error);
                } else {
                    reject(error);
                }
            });
        });
    }

    public stopSession(): Promise<void> {
        this.socket?.end();
        this.socket = undefined;
        return Promise.resolve();
    }
}

/** Upstream `SocketDebugAdapter`. */
export class SocketDebugAdapter extends NetworkDebugAdapter {
    public constructor(private readonly server: vscode.DebugAdapterServer) {
        super();
    }

    protected createConnection(connectionListener: () => void): net.Socket {
        // Without a host Node tries every address of `localhost` (upstream pins 127.0.0.1 for an older Node).
        return net.createConnection(this.server.port, this.server.host, connectionListener);
    }
}

/** Upstream `NamedPipeDebugAdapter`: a named pipe on Windows, a UNIX domain socket elsewhere. */
export class NamedPipeDebugAdapter extends NetworkDebugAdapter {
    public constructor(private readonly server: vscode.DebugAdapterNamedPipeServer) {
        super();
    }

    protected createConnection(connectionListener: () => void): net.Socket {
        return net.createConnection(this.server.path, connectionListener);
    }
}

/**
 * Upstream `ExecutableDebugAdapter`: the adapter is a process speaking DAP over stdin/stdout. What is wrong before
 * the spawn — no command, a missing file, `node` without a script — fails the start, so the user is told, as for a
 * port that refuses; upstream only reports it as the adapter's error, and the session vanished without a word.
 * `node` is forked: under
 * SEA `process.execPath` is diode, and the subprocess's `DIODE_RUN_AS_NODE=1` reaches the child, as
 * `ELECTRON_RUN_AS_NODE` does upstream. Its stderr is drained and dropped, as upstream's.
 */
export class ExecutableDebugAdapter extends StreamDebugAdapter {
    private child: cp.ChildProcess | undefined;

    public constructor(
        private readonly executable: vscode.DebugAdapterExecutable,
        private readonly debugType: string,
    ) {
        super();
    }

    public async startSession(): Promise<void> {
        const { command, args } = this.executable;
        const options = this.executable.options ?? {};
        if (!command) {
            throw new Error(`Cannot determine executable for debug adapter '${this.debugType}'.`);
        }
        if (path.isAbsolute(command) && !(await fs.promises.stat(command).catch(() => undefined))) {
            throw new Error(`Debug adapter executable '${command}' does not exist.`);
        }
        const env = { ...process.env, ...options.env };
        let child: cp.ChildProcess;
        if (command === "node") {
            if (args.length === 0) throw new Error("Unable to launch debug adapter.");
            child = cp.fork(args[0], args.slice(1), { env, execArgv: [], silent: true, cwd: options.cwd });
        } else {
            child = cp.spawn(command, args, { env, cwd: options.cwd });
        }
        // Stryker disable next-line ObjectLiteral,StringLiteral: equivalent, the label names the process only in the guard's log lines, and no logger is given
        const guarded = new GuardedChildProcess(child, { label: `debug adapter ${this.debugType}` });
        this.child = child;
        this.store.add(guarded);
        this.store.add(
            guarded.onDidEnd(({ code, error }) => {
                if (error === undefined) {
                    this.onExitEmitter.fire(code);
                } else {
                    // A child process fails with an `Error` (a failed spawn, a broken IPC channel).
                    this.onErrorEmitter.fire(error as Error);
                }
            }),
        );
        const { stdin, stdout, stderr } = child as cp.ChildProcessWithoutNullStreams;
        stdout.on("close", () => {
            this.onErrorEmitter.fire(new Error("read error"));
        });
        stdout.on("error", (error) => {
            this.onErrorEmitter.fire(error);
        });
        stdin.on("error", (error) => {
            this.onErrorEmitter.fire(error);
        });
        stderr.resume();
        // finally connect to the DA
        this.connect(stdout, stdin);
    }

    public stopSession(): Promise<void> {
        this.child?.kill("SIGTERM");
        return Promise.resolve();
    }
}

/** Upstream `ExtHostDebugService.createDebugAdapter` (node): the descriptors that need the OS. */
export function createNodeDebugAdapter(
    descriptor: vscode.DebugAdapterDescriptor,
    debugType: string,
): ExtHostDebugAdapter | undefined {
    if (descriptor instanceof DebugAdapterExecutable) {
        return new ExecutableDebugAdapter(descriptor, debugType);
    }
    if (descriptor instanceof DebugAdapterServer) {
        return new SocketDebugAdapter(descriptor);
    }
    if (descriptor instanceof DebugAdapterNamedPipeServer) {
        return new NamedPipeDebugAdapter(descriptor);
    }
    return undefined;
}
