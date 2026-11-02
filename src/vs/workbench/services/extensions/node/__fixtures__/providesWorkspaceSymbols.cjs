"use strict";

/**
 * Workspace symbol provider fixture: `partialSymbol` comes without a range, `resolveWorkspaceSymbol` gives it
 * line 2 of `target.ts` next to the workspace root, whose uri is taken from the first folder.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const { Location, Position, Range, SymbolInformation, SymbolKind } = vscode;
    const target = () => vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, "target.ts");
    context.subscriptions.push(
        vscode.languages.registerWorkspaceSymbolProvider({
            provideWorkspaceSymbols: function (query) {
                const partial = new SymbolInformation("partialSymbol", SymbolKind.Class, "Box", new Location(target(), new Position(0, 0)));
                partial.location = { uri: target() };
                return query === "nothing" ? [] : [partial];
            },
            resolveWorkspaceSymbol: function (symbol) {
                symbol.location = new Location(target(), new Range(2, 4, 2, 10));
                return symbol;
            },
        }),
    );
};
