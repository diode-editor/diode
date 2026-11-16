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
 *   the folder's `hello.c` with `argc` and `program` among the locals;
 * - the Debug Console gets output in ANSI colors with a link to `hello.c`, a group and a long line; the adapter
 *   completes the console's input (`completions`).
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
                        if (message.type === "event" && message.event !== "output")
                            tracked.text = `dap:${message.event}`;
                    },
                };
            },
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
            // What a test runner prints: SGR colors, a file link, a group, and a line longer than the console.
            this.event("output", { category: "stdout", output: "Checks", group: "start" });
            this.event("output", {
                category: "stdout",
                output: `\u001b[32mPASS\u001b[0m self-check \u001b[1;33m3/3\u001b[0m at ${this.source}:3:5\n`,
            });
            this.event("output", { category: "stdout", output: "\u001b[31mFAIL\u001b[0m none\n" });
            this.event("output", { category: "stdout", output: "", group: "end" });
            this.event("output", {
                category: "console",
                output: `${"A long line that the Debug Console wraps to its width, ".repeat(4)}end of the long line\n`,
            });
            this.event("stopped", { reason: "entry", threadId: 1, allThreadsStopped: true });
        }
        if (request.command === "disconnect") this.event("terminated");
    }

    answer(request) {
        switch (request.command) {
            case "initialize":
                return { supportsConfigurationDoneRequest: true, supportsCompletionsRequest: true };
            case "completions": {
                // The locals and `cfg` whose names start with the word before the cursor (`line` and `column` are
                // 1-based, in the input's lines).
                const { text, line = 1, column } = request.arguments;
                const word = /[\w$]*$/u.exec(text.split("\n")[line - 1].slice(0, column - 1))[0];
                const targets = ["argc", "program", "cfg", "count"]
                    .filter((name) => name.startsWith(word))
                    .map((label) => ({ label, type: "variable", length: word.length }));
                return { targets };
            }
            case "threads":
                return { threads: [{ id: 1, name: "main thread" }] };
            case "stackTrace":
                return {
                    stackFrames: [
                        {
                            id: 1,
                            name: "main",
                            line: 3,
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
