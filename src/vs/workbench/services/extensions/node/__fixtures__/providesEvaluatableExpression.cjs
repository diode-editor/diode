"use strict";

/**
 * Evaluatable expression provider fixture: the word under the position, evaluated as `this.<word>`; nothing on
 * the second line.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.languages.registerEvaluatableExpressionProvider(
            { language: "typescript" },
            {
                provideEvaluatableExpression: function (document, position) {
                    if (position.line !== 0) return undefined;
                    const range = document.getWordRangeAtPosition(position);
                    return range && new vscode.EvaluatableExpression(range, "this." + document.getText(range));
                },
            },
        ),
    );
};
