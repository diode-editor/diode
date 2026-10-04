"use strict";

/**
 * Фикстура rename-провайдера: переименовывает слово `value` в активном
 * документе и в соседнем файле `other.txt` (кросс-файловая правка — ровно то,
 * ради чего rename идёт через bulk workspace edit).
 *
 * Ветки `prepareRename` выбираются строкой каретки — покрывают обе формы
 * ответа эталона и отказ:
 *   - строка 0 → `{ range, placeholder }`;
 *   - строка 1 → голый `Range` (placeholder добирается текстом диапазона);
 *   - строка 2 → отказ («здесь переименовать нельзя»).
 *
 * `provideRenameEdits` отклоняет невалидное имя `class` — штатный канал
 * «имя не годится» эталона.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const path = require("node:path");

    context.subscriptions.push(
        vscode.languages.registerRenameProvider(
            { language: "plaintext" },
            {
                prepareRename: function (document, position) {
                    if (position.line === 2) {
                        return Promise.reject(new Error("You cannot rename this element."));
                    }
                    const range = new vscode.Range(0, 6, 0, 11);
                    if (position.line === 1) return range;
                    return { range: range, placeholder: "value" };
                },
                provideRenameEdits: function (document, position, newName) {
                    if (newName === "class") {
                        return Promise.reject(new Error("'class' is not a valid identifier"));
                    }
                    if (newName === "nothing") return null;
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(document.uri, new vscode.Range(0, 6, 0, 11), newName);
                    const neighbour = vscode.Uri.file(path.join(path.dirname(document.uri.fsPath), "other.txt"));
                    edit.replace(neighbour, new vscode.Range(0, 0, 0, 5), newName);
                    return edit;
                },
            },
        ),
    );
};
