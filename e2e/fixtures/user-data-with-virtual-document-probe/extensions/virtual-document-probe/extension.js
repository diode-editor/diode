// Each command does what an extension author would do, then reports what the API says in a toast the test reads off the frame.
const vscode = require("vscode");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = (text) => void vscode.window.showInformationMessage(text);

async function until(predicate) {
    for (let i = 0; i < 100 && !predicate(); i++) await sleep(50);
}

exports.activate = (context) => {
    let text = "first";
    const changed = new vscode.EventEmitter();
    const closedUris = [];
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider("vdoc", {
            onDidChange: changed.event,
            provideTextDocumentContent: (uri) => (uri.path === "/crlf" ? "a\r\nb\r\n" : text),
        }),
        vscode.workspace.onDidCloseTextDocument((doc) => closedUris.push(doc.uri.toString())),
        vscode.commands.registerCommand("probe.dirtyAfterProviderChange", async () => {
            const uri = vscode.Uri.parse("vdoc:/dirty");
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
            text = "second";
            changed.fire(uri);
            await until(() => doc.getText() === "second");
            report(`text=${doc.getText()} dirty=${doc.isDirty}`);
        }),
        vscode.commands.registerCommand("probe.closeTab", async () => {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse("vdoc:/closing"));
            await vscode.window.showTextDocument(doc);
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            await until(() => doc.isClosed);
            report(`closed=${doc.isClosed} listed=${vscode.workspace.textDocuments.includes(doc)}`);
        }),
        vscode.commands.registerCommand("probe.closeOneOfTwoEditors", async () => {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse("vdoc:/split"));
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.Two);
            await until(() => vscode.window.visibleTextEditors.length === 2);
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            await until(() => vscode.window.visibleTextEditors.length === 1);
            await sleep(300);
            const fired = closedUris.includes(doc.uri.toString());
            report(`shown=${vscode.window.visibleTextEditors.length} closed=${doc.isClosed} fired=${fired}`);
        }),
        vscode.commands.registerCommand("probe.crlf", async () => {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse("vdoc:/crlf"));
            const noTab = `${doc.eol}/${doc.getText().includes("\r\n")}`;
            await vscode.window.showTextDocument(doc);
            await sleep(200);
            report(`bare=${noTab} tab=${doc.eol}/${doc.getText().includes("\r\n")}`);
        }),
        vscode.commands.registerCommand("probe.languageWithoutTab", async () => {
            const [uri] = await vscode.workspace.findFiles("held.txt");
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.languages.setTextDocumentLanguage(doc, "json");
            report(`held=${doc.languageId}`);
        }),
        vscode.commands.registerCommand("probe.noFolders", async () => {
            const picked = await vscode.window.showWorkspaceFolderPick();
            report(`root=${vscode.workspace.rootPath} picked=${picked}`);
        }),
    );
    const ready = vscode.window.createStatusBarItem();
    ready.text = "probe-ready";
    ready.show();
    context.subscriptions.push(ready);
};
