"use strict";

/**
 * Фикстура references-провайдеров: регистрирует ДВА провайдера для typescript —
 * merge результатов нескольких провайдеров проверяется через настоящий
 * субпроцесс, а не только на стабе RPC.
 *   - первый  → ссылка в этом же файле, объявление отдаёт только при
 *     `context.includeDeclaration` (проверка, что контекст доезжает);
 *   - второй  → ссылка в соседнем файле (кросс-файловый случай);
 *   - на строке 1 оба молчат (пустой ответ).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.languages.registerReferenceProvider({ language: "typescript" }, {
            provideReferences: function (document, position, refContext) {
                if (position.line !== 0) return [];
                const here = [new vscode.Location(document.uri, new vscode.Range(0, 6, 0, 12))];
                if (!refContext.includeDeclaration) return here;
                return [new vscode.Location(document.uri, new vscode.Range(0, 0, 0, 5))].concat(here);
            },
        }),
        vscode.languages.registerReferenceProvider({ language: "typescript" }, {
            provideReferences: function (document, position) {
                if (position.line !== 0) return [];
                const other = document.uri.toString().replace("main.ts", "other.ts");
                return [new vscode.Location(vscode.Uri.parse(other), new vscode.Range(7, 2, 7, 8))];
            },
        }),
    );
};
