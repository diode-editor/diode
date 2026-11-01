"use strict";

const vscode = require("vscode");

/**
 * `TODO` is a link without a target, filled in by `resolveDocumentLink`; `https://…` gets the provider's own target,
 * to beat the built-in detector.
 */
exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.languages.registerDocumentLinkProvider("typescript", {
            provideDocumentLinks(document) {
                const links = [];
                for (let line = 0; line < document.lineCount; line++) {
                    const text = document.lineAt(line).text;
                    for (const match of text.matchAll(/TODO|https:\/\/\S+/g)) {
                        const range = new vscode.Range(line, match.index, line, match.index + match[0].length);
                        const link = new vscode.DocumentLink(range);
                        if (match[0] !== "TODO") link.target = vscode.Uri.parse("https://provider.example/won");
                        links.push(link);
                    }
                }
                return links;
            },
            resolveDocumentLink(link) {
                link.target = vscode.Uri.parse(`https://provider.example/resolved#${String(link.range.start.line)}`);
                return link;
            },
        }),
    );
};
