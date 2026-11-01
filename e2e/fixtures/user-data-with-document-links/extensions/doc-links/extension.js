"use strict";

const vscode = require("vscode");

/** `DOCS` is a link without a target: the provider gives it only on `resolveDocumentLink`. */
exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.languages.registerDocumentLinkProvider(
            { language: "plaintext" },
            {
                provideDocumentLinks(document) {
                    const links = [];
                    for (let line = 0; line < document.lineCount; line++) {
                        const index = document.lineAt(line).text.indexOf("DOCS");
                        if (index < 0) continue;
                        links.push(new vscode.DocumentLink(new vscode.Range(line, index, line, index + 4)));
                    }
                    return links;
                },
                resolveDocumentLink(link) {
                    link.target = vscode.Uri.parse("https://example.com/resolved");
                    return link;
                },
            },
        ),
    );
};
