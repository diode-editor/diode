// A root with two incoming calls and one outgoing call. Every provider call records the item it got: `data` lives
// only on the original object, so losing the identity across the wire shows up as `undefined`.
const vscode = require("vscode");

const seen = [];

function item(name, line, data) {
    const range = new vscode.Range(line, 0, line, name.length);
    const result = new vscode.CallHierarchyItem(
        vscode.SymbolKind.Function,
        name,
        `detail of ${name}`,
        vscode.window.activeTextEditor.document.uri,
        range,
        range,
    );
    result.data = data;
    return result;
}

exports.activate = (context) => {
    context.subscriptions.push(
        vscode.languages.registerCallHierarchyProvider("typescript", {
            prepareCallHierarchy: () => item("root", 0, "root-data"),
            provideCallHierarchyIncomingCalls(target) {
                seen.push(`incoming:${target.name}:${target.data}`);
                if (target.name !== "root") return [];
                return [
                    new vscode.CallHierarchyIncomingCall(item("callerB", 2, "b-data"), [
                        new vscode.Range(2, 4, 2, 8),
                    ]),
                    new vscode.CallHierarchyIncomingCall(item("callerA", 1, "a-data"), [
                        new vscode.Range(1, 6, 1, 10),
                        new vscode.Range(1, 2, 1, 4),
                    ]),
                ];
            },
            provideCallHierarchyOutgoingCalls(target) {
                seen.push(`outgoing:${target.name}:${target.data}`);
                if (target.name !== "root") return [];
                return [new vscode.CallHierarchyOutgoingCall(item("callee", 3, "c-data"), [new vscode.Range(0, 0, 0, 4)])];
            },
        }),
        vscode.commands.registerCommand("test.callHierarchy.seen", () => seen),
    );
};
