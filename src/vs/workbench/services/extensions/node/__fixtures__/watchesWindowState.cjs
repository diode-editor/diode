"use strict";

/**
 * Fixture for extensionHost.windowState.test.ts: reads `window.state` in activate(), keeps that object (a saved
 * snapshot must not follow later changes), records every `onDidChangeWindowState` with the getter's value at that
 * moment, and has a throwing listener subscribed first — the others must still hear the event.
 */
const vscode = require("vscode");

exports.activate = function activate(context) {
    const saved = vscode.window.state;
    const atActivate = { focused: saved.focused, active: saved.active };
    const events = [];
    const receiver = { events: events };
    context.subscriptions.push(
        vscode.window.onDidChangeWindowState(function () {
            throw new Error("a listener that throws");
        }),
    );
    vscode.window.onDidChangeWindowState(
        function (state) {
            this.events.push({
                focused: state.focused,
                active: state.active,
                getterFocused: vscode.window.state.focused,
            });
        },
        receiver,
        context.subscriptions,
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("test.windowState.report", function () {
            return {
                atActivate: atActivate,
                saved: { focused: saved.focused, active: saved.active },
                current: { focused: vscode.window.state.focused, active: vscode.window.state.active },
                events: events,
            };
        }),
    );
};
