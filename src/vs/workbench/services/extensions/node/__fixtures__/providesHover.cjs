"use strict";

/**
 * Фикстура hover-провайдеров: регистрирует ДВА провайдера для typescript —
 * merge результатов нескольких провайдеров проверяется через настоящий
 * субпроцесс, а не только на стабе RPC. Формы контента разные:
 *   - первый  → `vscode.Hover` с MarkdownString (fenced-сигнатура) и range;
 *   - второй  → `vscode.Hover` с legacy MarkedString-codeblock, без range;
 *   - на строке 1 оба молчат (пустой ответ).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.languages.registerHoverProvider({ language: "typescript" }, {
            provideHover: function (_document, position) {
                if (position.line !== 0) return null;
                const md = new vscode.MarkdownString("```ts\nconst answer: number\n```");
                return new vscode.Hover(md, new vscode.Range(0, 6, 0, 12));
            },
        }),
        vscode.languages.registerHoverProvider({ language: "typescript" }, {
            provideHover: function (_document, position) {
                if (position.line !== 0) return null;
                return new vscode.Hover({ language: "ts", value: "compute(): number" });
            },
        }),
    );
};
