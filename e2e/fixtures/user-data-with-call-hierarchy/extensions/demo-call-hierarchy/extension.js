// A call hierarchy over a fixed file: `render` is called by `paint` and `update`, and calls `measure`.
const vscode = require("vscode");

const LINES = { render: 0, measure: 3, paint: 6, update: 10 };
const CALLEES = { render: "measure", paint: "render", update: "render" };

function item(document, name) {
    const line = LINES[name];
    const start = "function ".length;
    const range = new vscode.Range(line, start, line, start + name.length);
    return new vscode.CallHierarchyItem(vscode.SymbolKind.Function, name, "sample.ts", document.uri, range, range);
}

function callIn(document, name, callee) {
    const line = LINES[name] + 1;
    const start = document.lineAt(line).text.indexOf(callee);
    return new vscode.Range(line, start, line, start + callee.length);
}

exports.activate = (context) => {
    context.subscriptions.push(
        vscode.languages.registerCallHierarchyProvider("typescript", {
            prepareCallHierarchy(document, position) {
                const range = document.getWordRangeAtPosition(position);
                const name = range === undefined ? "" : document.getText(range);
                return name in LINES ? item(document, name) : undefined;
            },
            async provideCallHierarchyIncomingCalls(target) {
                if (target.name !== "render") return [];
                const document = await vscode.workspace.openTextDocument(target.uri);
                return ["paint", "update"].map(
                    (name) =>
                        new vscode.CallHierarchyIncomingCall(item(document, name), [
                            callIn(document, name, "render"),
                        ]),
                );
            },
            async provideCallHierarchyOutgoingCalls(target) {
                const callee = CALLEES[target.name];
                if (callee === undefined) return [];
                const document = await vscode.workspace.openTextDocument(target.uri);
                return [
                    new vscode.CallHierarchyOutgoingCall(item(document, callee), [
                        callIn(document, target.name, callee),
                    ]),
                ];
            },
        }),
    );
};
