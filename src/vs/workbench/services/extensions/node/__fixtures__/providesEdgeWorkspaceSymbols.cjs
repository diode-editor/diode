"use strict";

/**
 * Workspace symbol provider fixture for the odd answers of real extensions: a symbol without a name, a deprecated one,
 * a plain object, `undefined` for an unknown query, a throw, and a resolve that throws. Query `cancel` records whether
 * the token fired, `cancelled` reports it.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const { Location, Position, Range, SymbolInformation, SymbolKind, SymbolTag } = vscode;
    const target = () => vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, "target.ts");
    let sawCancel = false;
    context.subscriptions.push(
        vscode.languages.registerWorkspaceSymbolProvider({
            provideWorkspaceSymbols: function (query, token) {
                if (query === "undefined") return undefined;
                if (query === "throw") throw new Error("provider failed");
                if (query === "cancel") {
                    return new Promise((resolve) => {
                        token.onCancellationRequested(() => {
                            sawCancel = true;
                            resolve([]);
                        });
                    });
                }
                if (query === "cancelled") {
                    return [new SymbolInformation(String(sawCancel), SymbolKind.Key, "", new Location(target(), new Position(0, 0)))];
                }
                if (query === "resolvethrows") {
                    return [new SymbolInformation("resolveThrows", SymbolKind.Class, "", new Location(target(), new Range(3, 0, 3, 1)))];
                }
                const old = new SymbolInformation("oldOne", SymbolKind.Method, "Box", new Location(target(), new Range(1, 0, 1, 1)));
                old.tags = [SymbolTag.Deprecated];
                const nameless = new SymbolInformation("x", SymbolKind.Method, "", new Location(target(), new Range(0, 0, 0, 1)));
                nameless.name = "";
                return [
                    old,
                    nameless,
                    {
                        name: "plainObject",
                        kind: SymbolKind.Enum,
                        containerName: "",
                        location: new Location(target(), new Position(2, 2)),
                    },
                ];
            },
            resolveWorkspaceSymbol: function (symbol) {
                if (symbol.name === "resolveThrows") throw new Error("resolve failed");
                return symbol;
            },
        }),
    );
};
