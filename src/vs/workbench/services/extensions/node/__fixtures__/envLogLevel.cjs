"use strict";

/**
 * Fixture for extensionHost.envLogLevel.test.ts: reads `env.logLevel` in activate(), like the
 * ruff and ms-python formatter wrappers, and records every `env.onDidChangeLogLevel` with the
 * getter's value at that moment.
 */
const vscode = require("vscode");

exports.activate = function activate(context) {
    const atActivate = vscode.env.logLevel;
    const events = [];
    context.subscriptions.push(
        vscode.env.onDidChangeLogLevel(function (level) {
            events.push({ level: level, getter: vscode.env.logLevel });
        }),
        vscode.commands.registerCommand("test.logLevel.state", function () {
            return { atActivate: atActivate, current: vscode.env.logLevel, events: events };
        }),
    );
};
