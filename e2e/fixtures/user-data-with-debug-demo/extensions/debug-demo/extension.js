"use strict";

/**
 * A debugger extension shaped like CodeLLDB: `contributes.debuggers` with `variables`, activation on
 * `onDebugResolve:demo`, a configuration provider. What the provider did shows in the `dbg:` status bar item.
 * - a configuration without `program` is `null`: the core opens launch.json (upstream's "fix your configuration");
 * - `${command:pickProgram}` is the extension's quick pick;
 * - the second resolution sees the substituted program and adds an argument.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    status.text = "dbg:-";
    status.show();
    context.subscriptions.push(status);

    context.subscriptions.push(
        vscode.commands.registerCommand("debugDemo.pickProgram", () =>
            vscode.window.showQuickPick(["./hello", "./world"], { placeHolder: "Pick the program to debug" }),
        ),
        vscode.debug.registerDebugConfigurationProvider("demo", {
            resolveDebugConfiguration(_folder, config) {
                if (!config.program) {
                    status.text = `dbg:no program in ${config.name}`;
                    return null;
                }
                return { ...config, stopOnEntry: true };
            },
            resolveDebugConfigurationWithSubstitutedVariables(folder, config) {
                status.text = `dbg:${config.program} in ${folder ? folder.name : "-"}`;
                return { ...config, args: ["--demo"] };
            },
        }),
    );
};
