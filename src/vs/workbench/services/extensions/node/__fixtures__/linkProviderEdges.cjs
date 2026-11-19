"use strict";

const vscode = require("vscode");

/**
 * Link providers with edge behaviours for `vscode.executeLinkProvider`, keyed by markers in the text:
 * - `lib:<name>` — no target, resolves to `https://lib.example/<name>`; `lib:boom` resolve throws, `lib:none` resolve
 *   answers `undefined`.
 * - `tgt:file` / `tgt:cmd` — the link comes with a `file:` / `command:` target.
 * - `ovr:<name>` — two providers both answer it, tooltips `first` and `second` (registered in that order).
 * - `https://own.example/...` — this extension claims the URL itself, tooltip `own`.
 * - `THROW` anywhere in the text — one more provider throws from provideDocumentLinks.
 */
function matches(document, regexp, make) {
    const links = [];
    for (let line = 0; line < document.lineCount; line++) {
        for (const match of document.lineAt(line).text.matchAll(regexp)) {
            const range = new vscode.Range(line, match.index, line, match.index + match[0].length);
            links.push(make(range, match));
        }
    }
    return links;
}

function plain(links) {
    return links.map((link) => ({
        range: [link.range.start.line, link.range.start.character, link.range.end.line, link.range.end.character],
        target: link.target?.toString(),
        tooltip: link.tooltip,
    }));
}

exports.activate = function activate(context) {
    const selector = "typescript";
    context.subscriptions.push(
        vscode.languages.registerDocumentLinkProvider(selector, {
            provideDocumentLinks(document) {
                if (document.getText().includes("THROW")) throw new Error("provider failure");
                return [];
            },
        }),
        vscode.languages.registerDocumentLinkProvider(selector, {
            provideDocumentLinks(document) {
                return matches(document, /lib:(\w+)/g, (range, match) => {
                    const link = new vscode.DocumentLink(range);
                    link.tooltip = match[1];
                    return link;
                });
            },
            resolveDocumentLink(link) {
                if (link.tooltip === "boom") throw new Error("resolve failure");
                if (link.tooltip === "none") return undefined;
                link.target = vscode.Uri.parse(`https://lib.example/${link.tooltip}`);
                return link;
            },
        }),
        vscode.languages.registerDocumentLinkProvider(selector, {
            provideDocumentLinks(document) {
                return matches(document, /tgt:(file|cmd)/g, (range, match) => {
                    const target =
                        match[1] === "file"
                            ? vscode.Uri.file("/tmp/target.txt")
                            : vscode.Uri.parse("command:test.noop");
                    return new vscode.DocumentLink(range, target);
                });
            },
        }),
        vscode.languages.registerDocumentLinkProvider(selector, {
            provideDocumentLinks(document) {
                return matches(document, /https:\/\/own\.example\/\S*/g, (range) => {
                    const link = new vscode.DocumentLink(range, vscode.Uri.parse("https://own.example/claimed"));
                    link.tooltip = "own";
                    return link;
                });
            },
        }),
        vscode.languages.registerDocumentLinkProvider(selector, {
            provideDocumentLinks(document) {
                return matches(document, /ovr:\w+/g, (range) => {
                    const link = new vscode.DocumentLink(range);
                    link.tooltip = "first";
                    return link;
                });
            },
        }),
        vscode.languages.registerDocumentLinkProvider(selector, {
            provideDocumentLinks(document) {
                return matches(document, /ovr:\w+/g, (range) => {
                    const link = new vscode.DocumentLink(range);
                    link.tooltip = "second";
                    return link;
                });
            },
        }),
        vscode.commands.registerCommand("test.links.run", async (uri, ...rest) => {
            const links = await vscode.commands.executeCommand(
                "vscode.executeLinkProvider",
                vscode.Uri.parse(uri),
                ...rest,
            );
            return plain(links);
        }),
        vscode.commands.registerCommand("test.links.raw", async (uri, parseUri, count) => {
            try {
                const first = parseUri ? vscode.Uri.parse(uri) : uri;
                const links = await vscode.commands.executeCommand("vscode.executeLinkProvider", first, count);
                return { ok: plain(links) };
            } catch (err) {
                return { error: String(err && err.message) };
            }
        }),
        vscode.commands.registerCommand("test.links.editThenRun", async (uri, text) => {
            const target = vscode.Uri.parse(uri);
            const edit = new vscode.WorkspaceEdit();
            edit.insert(target, new vscode.Position(0, 0), text);
            await vscode.workspace.applyEdit(edit);
            return plain(await vscode.commands.executeCommand("vscode.executeLinkProvider", target));
        }),
        vscode.commands.registerCommand("test.links.openThenRun", async (fsPath) => {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath));
            return plain(await vscode.commands.executeCommand("vscode.executeLinkProvider", document.uri));
        }),
    );
};
