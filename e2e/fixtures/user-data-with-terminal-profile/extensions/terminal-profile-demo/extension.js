"use strict";

/**
 * The shape of js-debug's debug terminal: the profile is declared in the manifest, the provider is registered on
 * activation, and the extension starts only when the person picks the profile (implicit `onTerminalProfile:<id>`).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    status.text = "profile:activated";
    status.show();
    context.subscriptions.push(status);

    context.subscriptions.push(
        vscode.window.registerTerminalProfileProvider("terminalProfileDemo.echo", {
            provideTerminalProfile() {
                const write = new vscode.EventEmitter();
                return new vscode.TerminalProfile({
                    name: "Echo Profile",
                    pty: {
                        onDidWrite: write.event,
                        open: () => write.fire("hello from the profile terminal\r\n"),
                        close: () => undefined,
                        handleInput: (data) => write.fire(data === "\r" ? "\r\n" : data),
                    },
                });
            },
        }),
    );
};

exports.deactivate = function deactivate() {};
