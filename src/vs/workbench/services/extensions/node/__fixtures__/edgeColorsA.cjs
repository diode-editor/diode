"use strict";

/**
 * Fixture for extensionHost.colors.edges.test.ts — provider A for css: colors the WORDS `red` and `blue`.
 * Markers in the document switch its answer: `ASYNC` (a promise), `PLAIN` (plain objects instead of the
 * classes), `SLOW` (answers a second late, ignoring its token), `UNDEF` (a promise of undefined), `OBJECT` (not an array), `WILD` (channels outside 0..1 at
 * `red`, NaN at `blue`), `FAR` (an extra color past the end of the document), `HANG` (never answers;
 * `edgeColorsA.cancelled` tells whether its token was cancelled), `THROW`. No `provideColorPresentations`.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const NAMED = { red: [1, 0, 0], blue: [0, 0, 1] };
    let cancelled = false;

    function words(document, plain, wild) {
        const text = document.getText();
        const colors = [];
        const re = /\b(red|blue)\b/g;
        let match;
        while ((match = re.exec(text)) !== null) {
            const start = document.positionAt(match.index);
            const end = document.positionAt(match.index + match[0].length);
            let [r, g, b] = NAMED[match[1]];
            if (wild) [r, g, b] = match[1] === "red" ? [2, -1, 0.5] : [Number.NaN, 0, 0];
            colors.push(
                plain
                    ? {
                          range: {
                              start: { line: start.line, character: start.character },
                              end: { line: end.line, character: end.character },
                          },
                          color: { red: r, green: g, blue: b, alpha: 1 },
                      }
                    : new vscode.ColorInformation(new vscode.Range(start, end), new vscode.Color(r, g, b, 1)),
            );
        }
        return colors;
    }

    context.subscriptions.push(
        vscode.languages.registerColorProvider(
            { language: "css" },
            {
                provideDocumentColors: function (document, token) {
                    const text = document.getText();
                    if (text.includes("THROW")) throw new Error("colors exploded");
                    if (text.includes("HANG")) {
                        token.onCancellationRequested(function () {
                            cancelled = true;
                        });
                        return new Promise(function () {});
                    }
                    if (text.includes("UNDEF")) return Promise.resolve(undefined);
                    if (text.includes("OBJECT")) return { colors: [] };
                    if (text.includes("SLOW")) {
                        const stale = words(document, false, false);
                        return new Promise(function (resolve) {
                            setTimeout(function () {
                                resolve(stale);
                            }, 1000);
                        });
                    }
                    if (text.includes("ASYNC")) {
                        return new Promise(function (resolve) {
                            setTimeout(function () {
                                resolve(words(document, false, false));
                            }, 50);
                        });
                    }
                    const colors = words(document, text.includes("PLAIN"), text.includes("WILD"));
                    if (text.includes("FAR")) {
                        colors.push(
                            new vscode.ColorInformation(new vscode.Range(999, 0, 999, 3), new vscode.Color(0, 1, 0, 1)),
                        );
                    }
                    return colors;
                },
            },
        ),
        vscode.commands.registerCommand("edgeColorsA.cancelled", function () {
            return cancelled;
        }),
    );
};
