"use strict";

const path = require("node:path");

/**
 * Фикстура definition-провайдера: для документов typescript возвращает цель в
 * файле `defs.ts` рядом с запрошенным документом. Форма результата зависит от
 * строки каретки — покрывает обе ветки нормализации:
 *   - строка 0 → одиночный `vscode.Location` (defs.ts:2:4–2:9);
 *   - иначе   → массив `LocationLink` (targetSelectionRange уже, чем targetRange).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider({ language: "typescript" }, {
            provideDefinition: function (document, position) {
                const defsUri = vscode.Uri.file(path.join(path.dirname(document.uri.fsPath), "defs.ts"));
                if (position.line === 0) {
                    return new vscode.Location(defsUri, new vscode.Range(2, 4, 2, 9));
                }
                return [
                    {
                        targetUri: defsUri,
                        targetRange: new vscode.Range(5, 0, 8, 1),
                        targetSelectionRange: new vscode.Range(5, 9, 5, 14),
                    },
                ];
            },
        }),
    );
};
