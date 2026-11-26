"use strict";

/**
 * Fixture for extensionHost.debug.test.ts: a debugger extension in the shape of CodeLLDB. A provider of the
 * `synthetic` type resolves configurations before and after their variables are substituted and fills a new
 * launch.json; a `*` provider marks every configuration; commands start and stop debugging and stand behind
 * `${command:pickProcess}`. What the provider saw is kept for `test.debug.seen`.
 */
const seen = [];

exports.activate = function activate(context) {
    const vscode = require("vscode");
    const folderName = (folder) => (folder === undefined ? "-" : folder.name);

    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider("synthetic", {
            provideDebugConfigurations(folder) {
                seen.push(`provide:${folderName(folder)}`);
                return [{ type: "synthetic", request: "launch", name: "From the provider", program: "a.out" }];
            },
            resolveDebugConfiguration(folder, config) {
                seen.push(`resolve:${folderName(folder)}:${config.name}`);
                if (config.name === "Abort") return undefined;
                if (config.name === "Open launch.json") return null;
                if (config.name === "Throw") throw new Error("the provider failed");
                return { ...config, resolvedBy: "synthetic" };
            },
            resolveDebugConfigurationWithSubstitutedVariables(folder, config) {
                seen.push(`resolve2:${folderName(folder)}:${config.pid}`);
                return { ...config, port: 4711 };
            },
        }),
        vscode.debug.registerDebugConfigurationProvider("*", {
            resolveDebugConfiguration(_folder, config) {
                return { ...config, star: true };
            },
        }),
        vscode.commands.registerCommand("test.debug.pickProcess", () => "4242"),
        vscode.commands.registerCommand("test.debug.start", (nameOrConfig) =>
            vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], nameOrConfig),
        ),
        vscode.commands.registerCommand("test.debug.stop", () => vscode.debug.stopDebugging()),
        vscode.commands.registerCommand("test.debug.seen", () => seen.splice(0)),
    );
};
