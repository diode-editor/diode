"use strict";

const vscode = require("vscode");

/** The targets real servers give: terraform-ls adds a query, gopls a module version; `TODO` has its target on resolve. */
const TARGETS = {
    QUERY: "https://registry.example/docs/x?utm_source=diode&utm_content=a,b#frag",
    VERSION: "https://pkg.example/golang.org/x/net@v0.1.0/html",
    MAIL: "mailto:a@b.example",
};

exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.languages.registerDocumentLinkProvider("typescript", {
            provideDocumentLinks(document) {
                const links = [];
                for (let line = 0; line < document.lineCount; line++) {
                    const text = document.lineAt(line).text;
                    for (const match of text.matchAll(/QUERY|VERSION|MAIL|TODO/g)) {
                        const range = new vscode.Range(line, match.index, line, match.index + match[0].length);
                        const link = new vscode.DocumentLink(range);
                        if (match[0] !== "TODO") link.target = vscode.Uri.parse(TARGETS[match[0]]);
                        links.push(link);
                    }
                }
                return links;
            },
            resolveDocumentLink(link) {
                link.target = vscode.Uri.parse("https://provider.example/resolved?a=b");
                return link;
            },
        }),
    );
};
