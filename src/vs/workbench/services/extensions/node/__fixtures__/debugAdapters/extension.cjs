"use strict";

/**
 * Fixture for extensionHost.debugAdapters.test.ts: a debugger extension with an adapter of every kind.
 * - `fixture-inline`: `DebugAdapterInlineImplementation` (CodeLLDB's shape);
 * - `fixture-server`: a TCP server of the extension, `DebugAdapterServer(port)`;
 * - `fixture-pipe`: a UNIX domain socket of the extension, `DebugAdapterNamedPipeServer(path)`;
 * - `fixture-exec`: a process, `DebugAdapterExecutable(<node>, [adapterProcess.cjs, …])`;
 * - `fixture-package`: no factory, the executable of `contributes.debuggers` (`runtime` + `program`);
 * - `fixture-missing`: `DebugAdapterExecutable` of a command that does not exist.
 * A `*` tracker records what it saw per session type; `test.debugAdapters.seen` hands the record out.
 */
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const { connectStream, createAdapter } = require("./dap.cjs");

const seen = [];

exports.activate = function activate(context) {
    const vscode = require("vscode");

    const servers = [];
    const listen = (server, address) =>
        new Promise((resolve) => {
            server.listen(address, () => resolve(server.address()));
        });
    const streamServer = (name) => {
        const server = net.createServer((socket) => connectStream(socket, socket, name, () => socket.destroy()));
        servers.push(server);
        return server;
    };

    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory("fixture-inline", {
            createDebugAdapterDescriptor(session, executable) {
                seen.push(`factory:${session.type}:${session.name}:${session.workspaceFolder?.name}:${executable}`);
                const emitter = new vscode.EventEmitter();
                const handle = createAdapter((message) => emitter.fire(message), "inline", () => undefined);
                return new vscode.DebugAdapterInlineImplementation({
                    onDidSendMessage: emitter.event,
                    handleMessage: handle,
                    dispose: () => seen.push("inline:disposed"),
                });
            },
        }),
        vscode.debug.registerDebugAdapterDescriptorFactory("fixture-server", {
            async createDebugAdapterDescriptor() {
                const { port } = await listen(streamServer("server"), { port: 0, host: "127.0.0.1" });
                return new vscode.DebugAdapterServer(port, "127.0.0.1");
            },
        }),
        vscode.debug.registerDebugAdapterDescriptorFactory("fixture-pipe", {
            async createDebugAdapterDescriptor() {
                const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-dap-"));
                const pipe = path.join(dir, "dap.sock");
                await listen(streamServer("pipe"), pipe);
                return new vscode.DebugAdapterNamedPipeServer(pipe);
            },
        }),
        vscode.debug.registerDebugAdapterDescriptorFactory("fixture-exec", {
            createDebugAdapterDescriptor() {
                return new vscode.DebugAdapterExecutable(process.execPath, [path.join(__dirname, "adapterProcess.cjs"), "exec"], {
                    cwd: __dirname,
                });
            },
        }),
        vscode.debug.registerDebugAdapterDescriptorFactory("fixture-missing", {
            createDebugAdapterDescriptor() {
                return new vscode.DebugAdapterExecutable(path.join(__dirname, "no-such-adapter"), []);
            },
        }),
        vscode.debug.registerDebugAdapterTrackerFactory("*", {
            createDebugAdapterTracker(session) {
                const record = (what) => seen.push(`${session.type}:${what}`);
                return {
                    onWillStartSession: () => record("start"),
                    onWillReceiveMessage: (m) => record(`> ${m.command}`),
                    onDidSendMessage: (m) => record(`< ${m.type === "event" ? m.event : m.command}`),
                    onWillStopSession: () => record("stop"),
                    onError: (e) => record(`error ${e.message}`),
                    onExit: (code) => record(`exit ${code}`),
                };
            },
        }),
        vscode.commands.registerCommand("test.debugAdapters.seen", () => seen.splice(0)),
        { dispose: () => servers.forEach((server) => server.close()) },
    );
};
