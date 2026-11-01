// The `type` command as an extension sees it, through the real RPC: calling it, `default:type`, overriding it.
const vscode = require("vscode");

function activate(context) {
    const register = (id, run) => context.subscriptions.push(vscode.commands.registerCommand(id, run));
    const received = [];
    let override;

    register("test.type.exec", (...args) => vscode.commands.executeCommand("type", ...args));
    register("test.type.execDefault", (args) => vscode.commands.executeCommand("default:type", args));

    register("test.type.setRules", () => {
        const language = vscode.window.activeTextEditor.document.languageId;
        context.subscriptions.push(
            vscode.languages.setLanguageConfiguration(language, {
                brackets: [["(", ")"]],
                autoClosingPairs: [{ open: "(", close: ")" }],
                onEnterRules: [
                    {
                        beforeText: /^\s*> /,
                        action: { indentAction: vscode.IndentAction.None, appendText: "> " },
                    },
                ],
            }),
        );
    });

    register("test.type.override", () => {
        override = vscode.commands.registerCommand("type", (args) => {
            received.push(args);
        });
    });
    register("test.type.received", () => received);
    register("test.type.disposeOverride", () => {
        override.dispose();
    });
}

module.exports = { activate };
