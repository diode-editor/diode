"use strict";

/** Пункт «Env demo ready» — сигнал сценарию, что коллекция уже записана. */
exports.activate = function activate(context) {
    const collection = context.environmentVariableCollection;
    collection.replace("DEMO_SERVER_PORT", "4242");
    collection.prepend("PATH", "/opt/demo-tools:");
    collection.description = "Demo server port and tools";

    const vscode = require("vscode");
    const ready = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    ready.text = "Env demo ready";
    ready.show();
    context.subscriptions.push(ready);
};
