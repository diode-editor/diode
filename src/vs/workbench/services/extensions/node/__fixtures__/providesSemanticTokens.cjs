"use strict";

/**
 * Фикстура для extensionHost.semanticTokens.test.ts.
 * Регистрирует для csharp провайдер семантических токенов документа (с
 * `onDidChangeSemanticTokens`) и провайдер диапазона. Правило разметки:
 * каждое слово — токен; с заглавной буквы — `class`, иначе — `variable`;
 * первое слово строки несёт модификатор `declaration`. Событие провайдера
 * документа срабатывает один раз — вскоре после его первого ответа.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const legend = new vscode.SemanticTokensLegend(["class", "variable"], ["declaration"]);

    function tokenize(document, fromLine, toLine) {
        const builder = new vscode.SemanticTokensBuilder(legend);
        for (let line = fromLine; line <= toLine; line++) {
            const text = document.lineAt(line).text;
            const words = /[A-Za-z_]\w*/g;
            let match;
            let first = true;
            while ((match = words.exec(text)) !== null) {
                const type = /^[A-Z]/.test(match[0]) ? "class" : "variable";
                const range = new vscode.Range(line, match.index, line, match.index + match[0].length);
                builder.push(range, type, first ? ["declaration"] : []);
                first = false;
            }
        }
        return builder.build();
    }

    const changed = new vscode.EventEmitter();
    let fired = false;
    context.subscriptions.push(
        vscode.languages.registerDocumentSemanticTokensProvider(
            "csharp",
            {
                onDidChangeSemanticTokens: changed.event,
                provideDocumentSemanticTokens: function (document) {
                    if (!fired) {
                        fired = true;
                        setTimeout(() => changed.fire(), 0);
                    }
                    return tokenize(document, 0, document.lineCount - 1);
                },
            },
            legend,
        ),
        vscode.languages.registerDocumentRangeSemanticTokensProvider(
            "csharp",
            {
                provideDocumentRangeSemanticTokens: function (document, range) {
                    return tokenize(document, range.start.line, range.end.line);
                },
            },
            legend,
        ),
    );
};
