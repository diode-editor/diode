"use strict";

/**
 * A debugger extension shaped like CodeLLDB: `contributes.debuggers` with `variables`, activation on
 * `onDebugResolve:demo`, a configuration provider, an adapter factory that hands out a
 * `DebugAdapterInlineImplementation`, a tracker. What the provider did shows in the `dbg:` status bar item, what the
 * tracker saw last in the `dap:` one.
 * - a configuration without `program` is `null`: the core opens launch.json (upstream's "fix your configuration");
 * - `${command:pickProgram}` is the extension's quick pick;
 * - the second resolution sees the substituted program and adds an argument;
 * - the adapter "runs" the program: it prints a greeting to the Debug Console and stops on entry in `main` of
 *   the folder's `hello.c` with `argc` and `program` among the locals; with breakpoints in `hello.c` (verified by
 *   `contributes.breakpoints` for C) it stops on the first of them instead;
 * - its custom `demoReady` event makes the extension ask the custom `demoInfo` request and print the answer to the
 *   Debug Console, as does the focused frame;
 * - "Debug Demo: Break on printf" adds a breakpoint at the `printf` line of `hello.c` and a function breakpoint.
 */
const path = require("node:path");

exports.activate = function activate(context) {
    const vscode = require("vscode");

    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    status.text = "dbg:-";
    status.show();
    const tracked = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    tracked.text = "dap:-";
    tracked.show();
    context.subscriptions.push(status, tracked);

    context.subscriptions.push(
        vscode.commands.registerCommand("debugDemo.pickProgram", () =>
            vscode.window.showQuickPick(["./hello", "./world"], { placeHolder: "Pick the program to debug" }),
        ),
        vscode.debug.registerDebugConfigurationProvider("demo", {
            resolveDebugConfiguration(_folder, config) {
                if (!config.program) {
                    status.text = `dbg:no program in ${config.name}`;
                    return null;
                }
                return { ...config, stopOnEntry: true };
            },
            resolveDebugConfigurationWithSubstitutedVariables(folder, config) {
                status.text = `dbg:${config.program} in ${folder ? folder.name : "-"}`;
                return { ...config, args: ["--demo"] };
            },
        }),
        vscode.debug.registerDebugAdapterDescriptorFactory("demo", {
            createDebugAdapterDescriptor(session) {
                const source = session.workspaceFolder && path.join(session.workspaceFolder.uri.fsPath, "hello.c");
                return new vscode.DebugAdapterInlineImplementation(
                    new DemoAdapter(vscode, session.configuration, source),
                );
            },
        }),
        vscode.debug.registerDebugAdapterTrackerFactory("demo", {
            createDebugAdapterTracker() {
                return {
                    onDidSendMessage(message) {
                        if (message.type === "event" && message.event !== "output") tracked.text = `dap:${message.event}`;
                    },
                };
            },
        }),
        // The session API: the adapter's custom event is answered with a custom request, the focused frame is
        // told in the Debug Console of the focused session.
        vscode.debug.onDidReceiveDebugSessionCustomEvent(async (e) => {
            if (e.event !== "demoReady") return;
            const info = await e.session.customRequest("demoInfo");
            vscode.debug.activeDebugConsole.appendLine(`Debug Demo: ${e.session.name} runs as pid ${info.pid}`);
        }),
        vscode.debug.onDidChangeActiveStackItem((item) => {
            if (item instanceof vscode.DebugStackFrame) {
                vscode.debug.activeDebugConsole.appendLine(`Debug Demo: frame ${item.frameId} of thread ${item.threadId}`);
            }
        }),
        vscode.commands.registerCommand("debugDemo.breakOnPrintf", () => {
            const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
            if (!folder) return;
            const uri = vscode.Uri.joinPath(folder.uri, "hello.c");
            vscode.debug.addBreakpoints([
                new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(3, 4))),
                new vscode.FunctionBreakpoint("printf"),
            ]);
        }),
    );
};

/** A pretend debugger of `program`: just enough DAP for a session that stops on entry. */
class DemoAdapter {
    constructor(vscode, configuration, source) {
        this.configuration = configuration;
        this.source = source;
        this.emitter = new vscode.EventEmitter();
        this.onDidSendMessage = this.emitter.event;
        this.seq = 1;
        /** The lines of the breakpoints in `hello.c`. */
        this.breakpoints = [];
    }

    handleMessage(request) {
        if (request.type !== "request") return;
        const body = this.answer(request);
        this.emitter.fire({
            seq: this.seq++,
            type: "response",
            request_seq: request.seq,
            command: request.command,
            success: true,
            body,
        });
        if (request.command === "launch") this.event("initialized");
        if (request.command === "configurationDone") {
            const { program, args } = this.configuration;
            this.event("output", { category: "stdout", output: `Hello from ${program} ${args.join(" ")}\n` });
            this.event("demoReady");
            const reason = this.breakpoints.length > 0 ? "breakpoint" : "entry";
            this.event("stopped", { reason, threadId: 1, allThreadsStopped: true });
        }
        if (request.command === "disconnect") this.event("terminated");
    }

    answer(request) {
        switch (request.command) {
            case "initialize":
                return { supportsConfigurationDoneRequest: true };
            case "setBreakpoints": {
                const lines = (request.arguments.breakpoints || []).map((bp) => bp.line);
                const known = request.arguments.source.path === this.source;
                if (known) this.breakpoints = lines.slice().sort((a, b) => a - b);
                return { breakpoints: lines.map((line) => ({ verified: known, line })) };
            }
            case "demoInfo":
                return { pid: 4242 };
            case "threads":
                return { threads: [{ id: 1, name: "main thread" }] };
            case "stackTrace":
                return {
                    stackFrames: [
                        {
                            id: 1,
                            name: "main",
                            line: this.breakpoints.length > 0 ? this.breakpoints[0] : 3,
                            column: 5,
                            source: this.source && { name: "hello.c", path: this.source },
                        },
                    ],
                    totalFrames: 1,
                };
            case "scopes":
                return { scopes: [{ name: "Locals", variablesReference: 1, expensive: false }] };
            case "variables":
                return {
                    variables: [
                        { name: "argc", value: String(this.configuration.args.length + 1), variablesReference: 0 },
                        { name: "program", value: JSON.stringify(this.configuration.program), variablesReference: 0 },
                    ],
                };
            default:
                return undefined;
        }
    }

    event(event, body) {
        this.emitter.fire({ seq: this.seq++, type: "event", event, body });
    }

    dispose() {}
}
