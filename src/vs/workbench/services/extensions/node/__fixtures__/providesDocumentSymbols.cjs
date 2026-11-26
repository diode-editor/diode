"use strict";

/**
 * Document symbol provider fixture:
 *   - typescript → a `DocumentSymbol` tree: class `Foo` with methods `paint` and `layout`;
 *   - python → a flat `SymbolInformation[]` whose ranges nest, one built with each constructor.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const { DocumentSymbol, Range, SymbolInformation, SymbolKind, SymbolTag, Location } = vscode;
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            { language: "typescript" },
            {
                provideDocumentSymbols: function () {
                    const foo = new DocumentSymbol("Foo", "class", SymbolKind.Class, new Range(0, 0, 9, 1), new Range(0, 6, 0, 9));
                    const paint = new DocumentSymbol("paint", "", SymbolKind.Method, new Range(1, 4, 3, 5), new Range(1, 4, 1, 9));
                    paint.tags = [SymbolTag.Deprecated];
                    const layout = new DocumentSymbol("layout", "", SymbolKind.Method, new Range(5, 4, 8, 5), new Range(5, 4, 5, 10));
                    foo.children = [paint, layout];
                    return [foo];
                },
            },
            { label: "fixture" },
        ),
        vscode.languages.registerDocumentSymbolProvider(
            { language: "python" },
            {
                provideDocumentSymbols: function (document) {
                    return [
                        new SymbolInformation("method", SymbolKind.Method, new Range(1, 0, 2, 0), document.uri, "Klass"),
                        new SymbolInformation(
                            "Klass",
                            SymbolKind.Class,
                            "",
                            new Location(document.uri, new Range(0, 0, 3, 0)),
                        ),
                        new SymbolInformation("after", SymbolKind.Function, new Range(5, 0, 6, 0)),
                    ];
                },
            },
        ),
    );
};
