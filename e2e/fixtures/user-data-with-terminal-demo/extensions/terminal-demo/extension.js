"use strict";

/** Like the cleanup commands of bazel-java and Code Runner: a named shell, `sendText`, `show`. */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    // Three short items: a status bar item has a width limit (24 characters).
    const item = (priority, text) => {
        const it = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
        it.text = text;
        it.show();
        context.subscriptions.push(it);
        return it;
    };
    const eventItem = item(103, "ev:-");
    const listItem = item(102, "ls:-");
    const activeItem = item(101, "act:-");

    const report = (event) => {
        eventItem.text = `ev:${event}`;
        listItem.text = `ls:${vscode.window.terminals.map((t) => t.name).join(",")}`;
        activeItem.text = `act:${vscode.window.activeTerminal ? vscode.window.activeTerminal.name : "-"}`;
    };
    context.subscriptions.push(
        vscode.window.onDidOpenTerminal((t) => report(`open ${t.name}`)),
        vscode.window.onDidCloseTerminal((t) => report(`close${t.exitStatus ? t.exitStatus.reason : "?"}`)),
        vscode.window.onDidChangeActiveTerminal(() => report("active")),
    );

    let demo;
    context.subscriptions.push(
        vscode.commands.registerCommand("terminalDemo.run", () => {
            demo = vscode.window.createTerminal({ name: "Demo Runner", env: { DEMO_GREETING: "hello" } });
            demo.sendText('echo "$DEMO_GREETING from Demo Runner"');
            demo.show();
        }),
        // An agent in a tab on the right — the shape of the stock Claude Code's
        // `claude-vscode.terminal.open`: a terminal in the editor area, Beside column.
        vscode.commands.registerCommand("terminalDemo.beside", () => {
            const agent = vscode.window.createTerminal({
                name: "Demo Agent",
                location: { viewColumn: vscode.ViewColumn.Beside },
                isTransient: true,
            });
            // The command itself does not contain "agent ready": in the narrow group on the right
            // the command wraps depending on the prompt length (the runner's hostname), and
            // "agent ready" split by a wrap would be waited for forever. The output —
            // 11 characters — always fits on one line.
            agent.sendText("printf 'agent %s\\n' ready");
            agent.show();
        }),
        vscode.commands.registerCommand("terminalDemo.list", () => report("list")),
        vscode.commands.registerCommand("terminalDemo.dispose", () => demo && demo.dispose()),
        // A log in a pty terminal — the shape of bazel-java's `getBazelTerminal()`: find our
        // terminal in window.terminals or create one with a pty, write via sendText
        // (the pty echoes the input recolored), show it.
        vscode.commands.registerCommand("terminalDemo.log", () => {
            const log = getLogTerminal(vscode);
            log.sendText("\u001b[32mlog: build started\u001b[0m");
            log.show();
        }),
    );
};

const LOG_NAME = "Demo Log";

/** A pty in the spirit of `BazelTerminal`: input (and sendText) is echoed back with CRLF. */
function createLogPty(vscode) {
    const writeEmitter = new vscode.EventEmitter();
    return {
        onDidWrite: writeEmitter.event,
        open: (dims) => {
            const size = dims === undefined ? "?" : `${dims.columns}x${dims.rows}`;
            writeEmitter.fire(`log pty opened ${size}\r\n`);
        },
        close: () => writeEmitter.dispose(),
        handleInput: (data) => {
            writeEmitter.fire(data.replace(/(\r|\n)+/g, "\r\n"));
        },
    };
}

function getLogTerminal(vscode) {
    const existing = vscode.window.terminals.find((t) => t.name === LOG_NAME);
    return existing || vscode.window.createTerminal({ name: LOG_NAME, pty: createLogPty(vscode) });
}

exports.deactivate = function deactivate() {};
