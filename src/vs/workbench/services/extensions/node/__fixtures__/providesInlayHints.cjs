"use strict";

/**
 * Fixture for extensionHost.inlayHints.test.ts. `const NAME = ` gets a type hint after the name; a document with
 * `THROW` gets an exception. `providesInlayHints.refresh` changes the label and fires `onDidChangeInlayHints`,
 * `providesInlayHints.unregister` disposes the registration. A second provider marks every `f(` with its own hint,
 * so its answer is on the frame whatever the first one does.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    let typeLabel = ": number";
    const changed = new vscode.EventEmitter();

    const registration = vscode.languages.registerInlayHintsProvider(
        { language: "typescript" },
        {
            onDidChangeInlayHints: changed.event,
            provideInlayHints: function (document, range) {
                const text = document.getText();
                if (text.includes("THROW")) throw new Error("hints exploded");
                const hints = [];
                const re = /const (\w+)/g;
                let match;
                while ((match = re.exec(text)) !== null) {
                    const position = document.positionAt(match.index + match[0].length);
                    if (!range.contains(position)) continue;
                    const hint = new vscode.InlayHint(position, typeLabel, vscode.InlayHintKind.Type);
                    hint.paddingLeft = true;
                    hints.push(hint);
                }
                return hints;
            },
        },
    );
    const second = vscode.languages.registerInlayHintsProvider(
        { language: "typescript" },
        {
            provideInlayHints: function (document) {
                const hints = [];
                const text = document.getText();
                const re = /f\(/g;
                let match;
                while ((match = re.exec(text)) !== null) {
                    const position = document.positionAt(match.index + match[0].length);
                    const hint = new vscode.InlayHint(
                        position,
                        [new vscode.InlayHintLabelPart("count"), new vscode.InlayHintLabelPart(":")],
                        vscode.InlayHintKind.Parameter,
                    );
                    hint.paddingRight = true;
                    hints.push(hint);
                }
                return hints;
            },
        },
    );
    context.subscriptions.push(
        registration,
        second,
        vscode.commands.registerCommand("providesInlayHints.refresh", function () {
            typeLabel = ": string";
            changed.fire();
        }),
        vscode.commands.registerCommand("providesInlayHints.unregister", function () {
            registration.dispose();
            second.dispose();
        }),
    );
};
