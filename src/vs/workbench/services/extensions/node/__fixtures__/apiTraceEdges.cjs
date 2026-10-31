"use strict";
const vscode = require("vscode");

exports.activate = function activate(context) {
    for (let i = 0; i < 1000; i++) vscode.workspace.getConfiguration("editor");

    context.subscriptions.push(
        // A response in a foreign thenable: the journal promises not to look into it.
        vscode.languages.registerCompletionItemProvider("editorconfig", {
            provideCompletionItems() {
                return {
                    then(resolve) {
                        resolve([{ label: "fromThenable" }]);
                    },
                };
            },
        }),
        // A field that is present but unset was not filled by the provider.
        vscode.languages.registerCompletionItemProvider("editorconfig", {
            provideCompletionItems() {
                return [{ label: "unsetField", detail: undefined, sortText: "a" }];
            },
        }),
        vscode.languages.registerCompletionItemProvider("editorconfig", {
            provideCompletionItems() {
                return [{ label: "resolvable" }];
            },
            resolveCompletionItem(item) {
                item.documentation = "resolved";
                return item;
            },
        }),
    );
};
