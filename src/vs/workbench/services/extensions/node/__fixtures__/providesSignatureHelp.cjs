"use strict";

/**
 * Signature help provider fixture: registers TWO providers for
 * typescript, so the "first non-empty answer wins" rule is checked through a
 * real subprocess, not only against an RPC stub.
 *   - first  → silent on line 0 (returns null), on line 1 returns its own
 *     signature (proving the order is respected);
 *   - second → on line 0 returns a signature with two parameters, echoing
 *     the context in the documentation (checks that triggerCharacter/isRetrigger
 *     reach the extension as a real `SignatureHelpContext`).
 *
 * The metadata is declared as an object: the overload the stock
 * vscode-languageclient picks when the server sent `retriggerCharacters`.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: function (document, position) {
                    if (position.line !== 1) return null;
                    const help = new vscode.SignatureHelp();
                    const signature = new vscode.SignatureInformation("first(): void");
                    signature.parameters = [];
                    help.signatures = [signature];
                    return help;
                },
            },
            { triggerCharacters: ["("], retriggerCharacters: [")"] },
        ),
        vscode.languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: function (document, position, token, sigContext) {
                    if (position.line !== 0) return null;
                    const help = new vscode.SignatureHelp();
                    const signature = new vscode.SignatureInformation(
                        "greet(name: string, age: number): void",
                        new vscode.MarkdownString(
                            "kind=" +
                                String(sigContext.triggerKind) +
                                " char=" +
                                String(sigContext.triggerCharacter) +
                                " retrigger=" +
                                String(sigContext.isRetrigger) +
                                " active=" +
                                String(sigContext.activeSignatureHelp && sigContext.activeSignatureHelp.activeSignature),
                        ),
                    );
                    signature.parameters = [
                        new vscode.ParameterInformation("name: string", "кого приветствуем"),
                        new vscode.ParameterInformation([20, 31]),
                    ];
                    help.signatures = [signature];
                    help.activeSignature = 0;
                    help.activeParameter = 1;
                    return help;
                },
            },
            ",",
            "<",
        ),
    );
};
