// A type hierarchy over a fixed file: `Shape` extends `Drawable`, `Circle` and `Square` implement `Shape`.
const vscode = require("vscode");

const TYPES = {
    Drawable: { line: 0, keyword: "interface", kind: "Interface" },
    Shape: { line: 1, keyword: "interface", kind: "Interface" },
    Circle: { line: 2, keyword: "class", kind: "Class" },
    Square: { line: 3, keyword: "class", kind: "Class" },
};
const SUBTYPES = { Drawable: ["Shape"], Shape: ["Circle", "Square"] };
const SUPERTYPES = { Shape: ["Drawable"], Circle: ["Shape"], Square: ["Shape"] };

function item(uri, name) {
    const { line, keyword, kind } = TYPES[name];
    const start = keyword.length + 1;
    const range = new vscode.Range(line, start, line, start + name.length);
    return new vscode.TypeHierarchyItem(vscode.SymbolKind[kind], name, "sample.ts", uri, range, range);
}

exports.activate = (context) => {
    context.subscriptions.push(
        vscode.languages.registerTypeHierarchyProvider("typescript", {
            prepareTypeHierarchy(document, position) {
                const range = document.getWordRangeAtPosition(position);
                const name = range === undefined ? "" : document.getText(range);
                return name in TYPES ? item(document.uri, name) : undefined;
            },
            provideTypeHierarchySubtypes: (target) => (SUBTYPES[target.name] ?? []).map((n) => item(target.uri, n)),
            provideTypeHierarchySupertypes: (target) => (SUPERTYPES[target.name] ?? []).map((n) => item(target.uri, n)),
        }),
    );
};
