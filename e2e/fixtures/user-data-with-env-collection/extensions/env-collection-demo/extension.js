"use strict";

/** The "Env demo ready" item signals the scenario that the collection is already written. */
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
