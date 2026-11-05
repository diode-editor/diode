"use strict";

/**
 * Fixture for extensionHost.testing.edges.test.ts: no controller at start; `test.probe.run` evaluates a
 * script body with `vscode`, a shared `state` object and `events` in scope and returns its (awaited) result.
 * The tests build the controllers they need through it.
 */
const vscode = require("vscode");

exports.activate = function activate(context) {
    const state = {};
    const events = [];
    context.subscriptions.push(
        vscode.commands.registerCommand("test.probe.run", async function (source) {
            const body = new Function("vscode", "state", "events", source);
            try {
                return { ok: await body(vscode, state, events) };
            } catch (error) {
                return { error: String(error && error.message ? error.message : error) };
            }
        }),
        vscode.commands.registerCommand("test.probe.events", function () {
            return events;
        }),
        vscode.commands.registerCommand("test.probe.kill", function () {
            setTimeout(function () {
                process.exit(1);
            }, 10);
            return "dying";
        }),
    );
};
