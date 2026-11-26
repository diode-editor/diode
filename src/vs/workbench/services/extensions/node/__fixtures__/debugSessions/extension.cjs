"use strict";

/**
 * Fixture for extensionHost.debugSessions.test.ts: an extension that watches the core's debug sessions.
 * `fixture-sessions` is an inline adapter (the tiny adapter of `../debugAdapters/dap.cjs`) that also sends a custom
 * `fixtureReady` event after `configurationDone`, answers the custom `echo` request with its arguments, fails `nope`,
 * verifies every breakpoint of `setBreakpoints` and, with a `program` in the launch configuration, has its frame there. Every `vscode.debug` event is recorded;
 * `test.debugSessions.*` commands hand the record out and act through the API.
 */
const { createAdapter } = require("../debugAdapters/dap.cjs");

const seen = [];

exports.activate = function activate(context) {
    const vscode = require("vscode");
    const debug = vscode.debug;
    const name = (session) => (session ? session.name : "none");
    const where = (bp) =>
        bp instanceof vscode.SourceBreakpoint
            ? `${vscode.workspace.asRelativePath(bp.location.uri)}:${bp.location.range.start.line}`
            : `function ${bp.functionName}`;
    const list = (bps) => bps.map(where).join(",");

    context.subscriptions.push(
        debug.registerDebugAdapterDescriptorFactory("fixture-sessions", {
            createDebugAdapterDescriptor() {
                const emitter = new vscode.EventEmitter();
                let seq = 1000;
                const send = (message) => emitter.fire(message);
                const respond = (request, body) =>
                    send({ seq: seq++, type: "response", request_seq: request.seq, command: request.command, success: true, body });
                const handle = createAdapter(send, "sessions", () => undefined);
                let nextId = 1;
                /** The launch configuration's `program`: the source of the only frame. */
                let program;
                return new vscode.DebugAdapterInlineImplementation({
                    onDidSendMessage: emitter.event,
                    handleMessage(message) {
                        if (message.type === "request" && message.command === "echo") {
                            respond(message, { echo: message.arguments });
                            return;
                        }
                        if (message.type === "request" && message.command === "nope") {
                            send({
                                seq: seq++,
                                type: "response",
                                request_seq: message.seq,
                                command: message.command,
                                success: false,
                                message: "unknown request 'nope'",
                            });
                            return;
                        }
                        if (message.type === "request" && message.command === "launch") {
                            program = message.arguments.program;
                        }
                        if (message.type === "request" && message.command === "stackTrace" && program) {
                            const frame = { id: 7, name: "sessions_main", line: 2, column: 1, source: { path: program } };
                            respond(message, { stackFrames: [frame], totalFrames: 1 });
                            return;
                        }
                        if (message.type === "request" && message.command === "setBreakpoints") {
                            const breakpoints = message.arguments.breakpoints.map((bp) => ({ id: nextId++, verified: true, line: bp.line }));
                            respond(message, { breakpoints });
                            return;
                        }
                        handle(message);
                        if (message.type === "request" && message.command === "configurationDone") {
                            send({ seq: seq++, type: "event", event: "fixtureReady", body: { ready: true } });
                        }
                    },
                    dispose: () => undefined,
                });
            },
        }),
        debug.onDidStartDebugSession((s) => seen.push(`started ${s.name} ${s.type} ${s.workspaceFolder ? "folder" : "no folder"}`)),
        debug.onDidTerminateDebugSession((s) => seen.push(`terminated ${s.name}`)),
        debug.onDidChangeActiveDebugSession((s) => seen.push(`active ${name(s)}`)),
        debug.onDidReceiveDebugSessionCustomEvent((e) => seen.push(`custom ${name(e.session)} ${e.event} ${JSON.stringify(e.body)}`)),
        debug.onDidChangeActiveStackItem((item) => {
            if (item === undefined) seen.push("stack none");
            else if (item instanceof vscode.DebugStackFrame) seen.push(`stack frame ${item.threadId}/${item.frameId} ${name(item.session)}`);
            else seen.push(`stack thread ${item.threadId} ${name(item.session)}`);
        }),
        debug.onDidChangeBreakpoints((e) =>
            seen.push(`breakpoints +[${list(e.added)}] -[${list(e.removed)}] ~[${list(e.changed)}]`),
        ),
        vscode.commands.registerCommand("test.debugSessions.seen", () => seen.splice(0)),
        vscode.commands.registerCommand("test.debugSessions.state", () => ({
            active: debug.activeDebugSession?.name,
            stackItem: debug.activeStackItem && { threadId: debug.activeStackItem.threadId, frameId: debug.activeStackItem.frameId },
            breakpoints: debug.breakpoints.map((bp) => ({ where: where(bp), enabled: bp.enabled, condition: bp.condition })),
        })),
        vscode.commands.registerCommand("test.debugSessions.echo", (args) => debug.activeDebugSession.customRequest("echo", args)),
        vscode.commands.registerCommand("test.debugSessions.unknownRequest", () =>
            debug.activeDebugSession.customRequest("nope").then(
                () => "resolved",
                (error) => `rejected: ${error.message}`,
            ),
        ),
        vscode.commands.registerCommand("test.debugSessions.rename", (newName) => {
            debug.activeDebugSession.name = newName;
            return debug.activeDebugSession.name;
        }),
        vscode.commands.registerCommand("test.debugSessions.console", (text) => {
            debug.activeDebugConsole.append(text);
            debug.activeDebugConsole.appendLine("!");
        }),
        vscode.commands.registerCommand("test.debugSessions.addBreakpoints", async (file, line) => {
            const uri = vscode.Uri.file(file);
            const source = new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(line, 0)), true, "i == 2");
            const fn = new vscode.FunctionBreakpoint("sessions_main");
            await debug.addBreakpoints([source, fn]);
            return [source.id, fn.id];
        }),
        vscode.commands.registerCommand("test.debugSessions.protocolBreakpoint", async () => {
            const bp = debug.breakpoints.find((b) => b instanceof vscode.SourceBreakpoint);
            return debug.activeDebugSession.getDebugProtocolBreakpoint(bp);
        }),
        vscode.commands.registerCommand("test.debugSessions.removeBreakpoints", () => debug.removeBreakpoints(debug.breakpoints)),
    );
};
