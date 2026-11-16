"use strict";

/**
 * Fixture for extensionHost.debugSessions.edges.test.ts: an extension that records every `vscode.debug` event with
 * the objects it got, and runs a snippet the test hands it (`test.debugProbe.run`) with `vscode`, the record and
 * `store` (a place to keep objects between snippets) in scope. `fixture-probe` is an inline adapter: two threads,
 * two frames on thread 1, the custom `echo`/`nope` requests, every breakpoint verified.
 */
const events = [];
const store = {};

exports.activate = function activate(context) {
    const vscode = require("vscode");
    const debug = vscode.debug;
    const record = (kind, value) => events.push({ kind, value });

    context.subscriptions.push(
        debug.registerDebugAdapterDescriptorFactory("fixture-probe", {
            createDebugAdapterDescriptor() {
                const emitter = new vscode.EventEmitter();
                let seq = 1;
                let bpId = 1;
                let source;
                const send = (message) => emitter.fire({ seq: seq++, ...message });
                const respond = (request, body) =>
                    send({ type: "response", request_seq: request.seq, command: request.command, success: true, body });
                const event = (name, body) => send({ type: "event", event: name, body });
                return new vscode.DebugAdapterInlineImplementation({
                    onDidSendMessage: emitter.event,
                    handleMessage(m) {
                        if (m.type !== "request") return;
                        switch (m.command) {
                            case "initialize":
                                return respond(m, { supportsConfigurationDoneRequest: true, supportsFunctionBreakpoints: true });
                            case "launch":
                                source = m.arguments.program && { path: m.arguments.program };
                                respond(m);
                                return event("initialized");
                            case "configurationDone":
                                respond(m);
                                event("probeReady", { n: 1 });
                                return event("stopped", { reason: "entry", threadId: 1, allThreadsStopped: true });
                            case "threads":
                                return respond(m, { threads: [{ id: 1, name: "one" }, { id: 2, name: "two" }] });
                            case "stackTrace":
                                return respond(m, {
                                    stackFrames:
                                        m.arguments.threadId === 1
                                            ? [{ id: 11, name: "top", line: 1, column: 1, source }, { id: 12, name: "caller", line: 2, column: 1, source }]
                                            : [{ id: 21, name: "other", line: 1, column: 1, source }],
                                    totalFrames: m.arguments.threadId === 1 ? 2 : 1,
                                });
                            case "scopes":
                                return respond(m, { scopes: [] });
                            case "echo":
                                return respond(m, { echo: m.arguments });
                            case "nope":
                                return send({ type: "response", request_seq: m.seq, command: m.command, success: false, message: "no such request" });
                            case "setBreakpoints":
                                return respond(m, { breakpoints: m.arguments.breakpoints.map((bp) => ({ id: bpId++, verified: true, line: bp.line })) });
                            case "setFunctionBreakpoints":
                                return respond(m, { breakpoints: m.arguments.breakpoints.map(() => ({ id: bpId++, verified: true })) });
                            case "disconnect":
                                respond(m);
                                return event("terminated");
                            default:
                                return respond(m);
                        }
                    },
                    dispose: () => undefined,
                });
            },
        }),
        debug.onDidStartDebugSession((s) => record("start", s)),
        debug.onDidTerminateDebugSession((s) => record("terminate", s)),
        debug.onDidChangeActiveDebugSession((s) => record("active", s)),
        debug.onDidReceiveDebugSessionCustomEvent((e) => record("custom", e)),
        debug.onDidChangeActiveStackItem((i) => record("stack", i)),
        debug.onDidChangeBreakpoints((e) => record("breakpoints", e)),
        vscode.commands.registerCommand("test.debugProbe.run", async (code) => {
            // eslint-disable-next-line no-new-func -- the test's snippet
            const fn = new Function("vscode", "events", "store", `return (async () => { ${code} })();`);
            return fn(vscode, events, store);
        }),
    );
};
