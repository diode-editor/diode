"use strict";

/**
 * Фикстура selection-range-провайдера: на каждую позицию — цепочка
 * «строка позиции» → «строка позиции и следующая». Вторая ступень не совпадает
 * ни с одной встроенной (слово, скобки, строка, документ), поэтому её видно
 * в итоговой иерархии — значит, ответ провайдера доехал.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.languages.registerSelectionRangeProvider(
            { language: "plaintext" },
            {
                provideSelectionRanges: function (document, positions) {
                    return positions.map(function (position) {
                        const line = document.lineAt(position.line).range;
                        const next = document.lineAt(position.line + 1).range;
                        const pair = new vscode.SelectionRange(new vscode.Range(line.start, next.end));
                        return new vscode.SelectionRange(line, pair);
                    });
                },
            },
        ),
    );
};
