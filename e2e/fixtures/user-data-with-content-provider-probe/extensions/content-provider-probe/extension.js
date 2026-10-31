// Two providers on one scheme, a virtual document with the language set before it has a tab, then a language change on it.
const vscode = require("vscode");

exports.activate = (context) => {
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider("probe", {
            provideTextDocumentContent: (uri) => (uri.authority === "first" ? "from the first provider" : undefined),
        }),
        vscode.workspace.registerTextDocumentContentProvider("probe", {
            provideTextDocumentContent: (uri) => (uri.authority === "second" ? "from the second provider" : undefined),
        }),
        vscode.commands.registerCommand("probe.openVirtual", async () => {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse("probe://first/virtual.txt"));
            await vscode.languages.setTextDocumentLanguage(doc, "json");
            await vscode.window.showTextDocument(doc);
        }),
        vscode.commands.registerCommand("probe.setLanguage", async () => {
            const doc = vscode.window.activeTextEditor.document;
            await vscode.languages.setTextDocumentLanguage(doc, "python");
            const known = (await vscode.languages.getLanguages()).includes("python");
            const commands = await vscode.commands.getCommands(true);
            vscode.window.showInformationMessage(
                `Language now ${doc.languageId}, known ${known}, listed ${commands.includes("probe.setLanguage")}`,
            );
        }),
        vscode.commands.registerCommand("probe.pickFolder", async () => {
            const folder = await vscode.window.showWorkspaceFolderPick();
            vscode.window.showInformationMessage(`Folder ${folder?.name} root ${vscode.workspace.rootPath === folder?.uri.fsPath}`);
        }),
    );
};
