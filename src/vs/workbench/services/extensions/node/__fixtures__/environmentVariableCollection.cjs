"use strict";

/**
 * Fixture for extensionHost.environmentVariableCollection.test.ts: like the stock
 * `Anthropic.claude-code`, on activation it puts its server port into the terminal
 * environment collection (`get` → `replace` if the value differs).
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
