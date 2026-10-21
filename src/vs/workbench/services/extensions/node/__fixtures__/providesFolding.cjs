"use strict";

/**
 * Fixture for extensionHost.folding.test.ts.
 * Registers a folding provider for csharp (the selector is a language-id array,
 * as in the stock extension maptz.regionfolder). The provider scans document lines for
 * `#region` / `#endregion` markers and returns `vscode.FoldingRange` of kind Region,
 * the same path as the real extension's MyFoldingRangeProvider.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.languages.registerFoldingRangeProvider(["csharp"], {
            provideFoldingRanges: function (document) {
                const lines = document.getText().split("\n");
                const stack = [];
                const ranges = [];
                for (let i = 0; i < lines.length; i++) {
                    if (/#region\b/.test(lines[i])) {
                        stack.push(i);
                    } else if (/#endregion\b/.test(lines[i])) {
                        const start = stack.pop();
                        if (start !== undefined) {
                            ranges.push(new vscode.FoldingRange(start, i, vscode.FoldingRangeKind.Region));
                        }
                    }
                }
                return ranges;
            },
        }),
    );
};
