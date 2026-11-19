"use strict";

const vscode = require("vscode");

/**
 * A provider with `resolveDocumentLink` for `lib:<name>`, and a command that runs `vscode.executeLinkProvider` and
 * answers what the extension got, as plain data.
 */
exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.languages.registerDocumentLinkProvider("typescript", {
            provideDocumentLinks(document) {
                const links = [];
                for (let line = 0; line < document.lineCount; line++) {
                    for (const match of document.lineAt(line).text.matchAll(/lib:(\w+)/g)) {
                        const link = new vscode.DocumentLink(
                            new vscode.Range(line, match.index, line, match.index + match[0].length),
                        );
                        link.tooltip = match[1];
                        links.push(link);
                    }
                }
                return links;
            },
            resolveDocumentLink(link) {
                link.target = vscode.Uri.parse(`https://lib.example/${link.tooltip}`);
                return link;
            },
        }),
        vscode.commands.registerCommand("test.executeLinkProvider", async (uri, linkResolveCount) => {
            const links = await vscode.commands.executeCommand(
                "vscode.executeLinkProvider",
                vscode.Uri.parse(uri),
                linkResolveCount,
            );
            return links.map((link) => ({
                isDocumentLink: link instanceof vscode.DocumentLink,
                range: [link.range.start.line, link.range.start.character, link.range.end.line, link.range.end.character],
                target: link.target?.toString(),
                tooltip: link.tooltip,
            }));
        }),
    );
};
