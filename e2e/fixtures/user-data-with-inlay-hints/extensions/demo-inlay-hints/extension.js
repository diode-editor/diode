"use strict";

/**
 * A type hint after `const NAME` and a parameter name before the argument of `add(`. The labels are invented by
 * this provider: there is no language server in the demo.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.languages.registerInlayHintsProvider(
            { language: "typescript" },
            {
                provideInlayHints(document, range) {
                    const text = document.getText();
                    const hints = [];
                    for (const match of text.matchAll(/const (\w+)/g)) {
                        const position = document.positionAt(match.index + match[0].length);
                        if (!range.contains(position)) continue;
                        const hint = new vscode.InlayHint(position, ": number", vscode.InlayHintKind.Type);
                        hint.paddingLeft = true;
                        hints.push(hint);
                    }
                    for (const match of text.matchAll(/add\(/g)) {
                        const position = document.positionAt(match.index + match[0].length);
                        if (!range.contains(position)) continue;
                        const hint = new vscode.InlayHint(
                            position,
                            [new vscode.InlayHintLabelPart("left"), new vscode.InlayHintLabelPart(":")],
                            vscode.InlayHintKind.Parameter,
                        );
                        hint.paddingRight = true;
                        hints.push(hint);
                    }
                    return hints;
                },
            },
        ),
    );
};

exports.deactivate = function deactivate() {};
