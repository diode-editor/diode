// Logs the file operation events in order; on demand, a will event inserts text through `waitUntil`.
const vscode = require("vscode");

const log = [];
let insert = null;

const name = (uri) => uri.path.split("/").pop();

exports.activate = (context) => {
    const subscribe = (event, label, format) => {
        context.subscriptions.push(
            event((e) => {
                log.push(`${label} ${e.files.map(format).join(",")}`);
                if (insert !== null && e.waitUntil !== undefined) {
                    const edit = new vscode.WorkspaceEdit();
                    edit.insert(vscode.Uri.parse(insert.uri), new vscode.Position(0, 0), insert.text);
                    e.waitUntil(Promise.resolve(edit));
                }
            }),
        );
    };
    const pair = (file) => `${name(file.oldUri)}>${name(file.newUri)}`;
    subscribe(vscode.workspace.onWillCreateFiles, "willCreate", name);
    subscribe(vscode.workspace.onDidCreateFiles, "didCreate", name);
    subscribe(vscode.workspace.onWillDeleteFiles, "willDelete", name);
    subscribe(vscode.workspace.onDidDeleteFiles, "didDelete", name);
    subscribe(vscode.workspace.onWillRenameFiles, "willRename", pair);
    subscribe(vscode.workspace.onDidRenameFiles, "didRename", pair);
    context.subscriptions.push(
        vscode.commands.registerCommand("test.fileOps.log", () => log.splice(0)),
        vscode.commands.registerCommand("test.fileOps.insert", (uri, text) => {
            insert = { uri, text };
        }),
        vscode.commands.registerCommand("test.fileOps.renameViaEdit", (from, to) => {
            const edit = new vscode.WorkspaceEdit();
            edit.renameFile(vscode.Uri.parse(from), vscode.Uri.parse(to));
            return vscode.workspace.applyEdit(edit);
        }),
    );
};
