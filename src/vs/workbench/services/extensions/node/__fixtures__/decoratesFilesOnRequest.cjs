"use strict";

/**
 * Fixture for extensionHost.fileDecorations.test.ts: file decoration providers the test drives by commands.
 *
 *  - `test.files.register(name, withEvent)` registers a provider; without `withEvent` it has no
 *    `onDidChangeFileDecorations` (a pull-only provider, as `vscjava.vscode-maven`);
 *  - `test.files.answer(name, uri, spec)` sets its answer for the uri string: `{ badge, tooltip, color, propagate }`,
 *    `"throw"` or `null` (no decoration);
 *  - `test.files.fire(name, uris)` fires its event with those uri strings, or with `undefined` without them;
 *  - `test.files.dispose(name)` disposes its registration; `test.files.asked(name)` returns what it was asked.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const providers = new Map();

    function decorationOf(spec) {
        const color = spec.color === undefined ? undefined : new vscode.ThemeColor(spec.color);
        const decoration = new vscode.FileDecoration(spec.badge, spec.tooltip, color);
        if (spec.propagate !== undefined) decoration.propagate = spec.propagate;
        return decoration;
    }

    context.subscriptions.push(
        vscode.commands.registerCommand("test.files.register", function (name, withEvent) {
            const state = { answers: new Map(), asked: [], emitter: new vscode.EventEmitter() };
            const provider = {
                provideFileDecoration: function (uri) {
                    state.asked.push(uri.toString());
                    const spec = state.answers.get(uri.toString());
                    if (spec === "throw") throw new Error("provider " + name + " failed");
                    return spec == null ? undefined : decorationOf(spec);
                },
            };
            if (withEvent === true) provider.onDidChangeFileDecorations = state.emitter.event;
            state.registration = vscode.window.registerFileDecorationProvider(provider);
            providers.set(name, state);
        }),
        vscode.commands.registerCommand("test.files.answer", function (name, uri, spec) {
            providers.get(name).answers.set(uri, spec);
        }),
        vscode.commands.registerCommand("test.files.fire", function (name, uris) {
            const state = providers.get(name);
            state.emitter.fire(uris === undefined ? undefined : uris.map((uri) => vscode.Uri.parse(uri)));
        }),
        vscode.commands.registerCommand("test.files.dispose", function (name) {
            providers.get(name).registration.dispose();
        }),
        vscode.commands.registerCommand("test.files.asked", function (name) {
            return providers.get(name).asked;
        }),
    );
};
