// A root with two subtypes and one supertype. Every provider call records the item it got: `data` lives only on the
// original object, so losing the identity across the wire shows up as `undefined`.
const vscode = require("vscode");

const seen = [];

function item(name, line, data) {
    const range = new vscode.Range(line, 0, line, name.length);
    const result = new vscode.TypeHierarchyItem(
        vscode.SymbolKind.Interface,
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
        vscode.languages.registerTypeHierarchyProvider("typescript", {
            prepareTypeHierarchy: () => item("root", 0, "root-data"),
            provideTypeHierarchySubtypes(target) {
                seen.push(`subtypes:${target.name}:${target.data}`);
                if (target.name !== "root") return [];
                return [item("subB", 2, "b-data"), item("subA", 1, "a-data")];
            },
            provideTypeHierarchySupertypes(target) {
                seen.push(`supertypes:${target.name}:${target.data}`);
                if (target.name !== "root") return [];
                return [item("base", 3, "base-data")];
            },
        }),
        vscode.commands.registerCommand("test.typeHierarchy.seen", () => seen),
    );
};
