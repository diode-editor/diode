"use strict";

/**
 * Демо-расширение терминалов (`window.createTerminal`): заводит шелл с именем,
 * шлёт в него команды `sendText` и показывает (`show`) — ровно так работают
 * cleanup-команды bazel-java и Code Runner. Что расширение видит в ответ
 * (`window.terminals`, `activeTerminal`, события, `exitStatus`), пишется в
 * пункты статус-бара `ev:`/`ls:`/`act:` — их видно в кадре.
 *
 * Используется e2e-сценарием extensionTerminal и ручной проверкой:
 *   diode --user-data-dir=<каталог с этой фикстурой> <какой-нибудь файл>
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    // Три коротких пункта: у пункта статус-бара предел ширины (24 символа).
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
        vscode.commands.registerCommand("terminalDemo.list", () => report("list")),
        vscode.commands.registerCommand("terminalDemo.dispose", () => demo && demo.dispose()),
        // Лог в pty-терминале — форма `getBazelTerminal()` bazel-java: найти свой
        // терминал в window.terminals или завести с pty, писать через sendText
        // (pty эхом перекрашивает ввод), показать.
        vscode.commands.registerCommand("terminalDemo.log", () => {
            const log = getLogTerminal(vscode);
            log.sendText("\u001b[32mlog: build started\u001b[0m");
            log.show();
        }),
    );
};

const LOG_NAME = "Demo Log";

/** Pty в духе `BazelTerminal`: ввод (и sendText) возвращается эхом с CRLF. */
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
