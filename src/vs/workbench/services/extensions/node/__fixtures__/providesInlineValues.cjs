"use strict";

/**
 * Fixture for extensionHost.inlineValues.test.ts: an inline values provider for C that answers each kind once on
 * the stopped line — the text with the frame's id, a lookup of `sum`, an expression `sum * 2`.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.languages.registerInlineValuesProvider("c", {
            provideInlineValues(document, viewPort, inlineContext) {
                const line = inlineContext.stoppedLocation.start.line;
                const range = new vscode.Range(line, 4, line, 7);
                return [
                    new vscode.InlineValueText(range, `frame ${inlineContext.frameId} of ${viewPort.end.line + 1} lines`),
                    new vscode.InlineValueVariableLookup(range, "sum"),
                    new vscode.InlineValueEvaluatableExpression(range, "sum * 2"),
                ];
            },
        }),
    );
};
