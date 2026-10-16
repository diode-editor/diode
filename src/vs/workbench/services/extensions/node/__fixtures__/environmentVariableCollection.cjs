"use strict";

/**
 * Фикстура для extensionHost.environmentVariableCollection.test.ts: как стоковое
 * `Anthropic.claude-code` — на активации кладёт порт своего сервера в коллекцию
 * окружения терминалов (`get` → `replace`, если значение другое).
 */
const vscode = require("vscode");

let activations = 0;

exports.activate = function activate(context) {
    activations++;
    const collection = context.environmentVariableCollection;
    const seenAtActivation = collection.get("DIODE_TEST_PORT")?.value;
    if (seenAtActivation !== "4242") collection.replace("DIODE_TEST_PORT", "4242");
    collection.description = "Test port";
    context.subscriptions.push(
        vscode.commands.registerCommand("test.env.seenAtActivation", function () {
            return { seenAtActivation, activations };
        }),
        vscode.commands.registerCommand("test.env.prependPath", function () {
            collection.prepend("PATH", "/opt/test:");
        }),
        vscode.commands.registerCommand("test.env.clear", function () {
            collection.clear();
        }),
    );
};
