"use strict";

/**
 * Hover provider fixture: registers TWO providers for typescript, so
 * merging results of several providers is checked through a real
 * subprocess, not only against an RPC stub. The content shapes differ:
 *   - first  → `vscode.Hover` with a MarkdownString (fenced signature) and a range;
 *   - second → `vscode.Hover` with a legacy MarkedString codeblock, no range;
 *   - on line 1 both stay silent (empty answer).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.languages.registerHoverProvider({ language: "typescript" }, {
            provideHover: function (_document, position) {
                if (position.line !== 0) return null;
                const md = new vscode.MarkdownString("```ts\nconst answer: number\n```");
                return new vscode.Hover(md, new vscode.Range(0, 6, 0, 12));
            },
        }),
        vscode.languages.registerHoverProvider({ language: "typescript" }, {
            provideHover: function (_document, position) {
                if (position.line !== 0) return null;
                return new vscode.Hover({ language: "ts", value: "compute(): number" });
            },
        }),
    );
};
