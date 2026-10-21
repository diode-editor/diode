"use strict";

/**
 * Fixture for extensionHost.quickPickSubprocess.test.ts: the object picker
 * (`window.createQuickPick`) through a REAL subprocess.
 *
 * Commands return what the extension got from the user, together with a log of
 * picker events: the command's value is the signal to the outside (fixture convention).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    /** The picker shown by command test.showForHide. */
    let shown;

    const SOURCE = [
        { description: "Alpha module", value: "example.com/alpha" },
        { description: "Beta module", value: "example.com/beta" },
        { description: "Gamma", value: "Gamma" },
    ];

    context.subscriptions.push(
        // The shape of golang.go's `pickLazyEnum`: the picker opens empty, items
        // arrive asynchronously on every query change, Enter accepts, and the
        // extension hides and disposes the picker itself.
        vscode.commands.registerCommand("test.lazyPick", function () {
            return new Promise(function (resolve) {
                const log = [];
                const quickPick = vscode.window.createQuickPick();
                quickPick.title = "Lazy enum";
                quickPick.placeholder = "Type to search modules";
                quickPick.matchOnDescription = true;
                let resolved = false;
                const search = function (query) {
                    quickPick.busy = true;
                    setTimeout(function () {
                        quickPick.items = SOURCE.filter(function (entry) {
                            return entry.value.toLowerCase().includes(query.toLowerCase());
                        }).map(function (entry) {
                            return {
                                label: entry.description,
                                detail: entry.value !== entry.description ? entry.value : undefined,
                                value: entry.value,
                            };
                        });
                        quickPick.busy = false;
                        // A visible "the answer to this query has arrived" sign for the test.
                        quickPick.prompt = query === "" ? undefined : "results for " + query;
                    }, 0);
                };
                quickPick.onDidChangeValue(function (value) {
                    log.push("value:" + value);
                    search(value);
                });
                quickPick.onDidChangeSelection(function (items) {
                    log.push(
                        "selection:" +
                            items
                                .map(function (item) {
                                    return item.label;
                                })
                                .join(","),
                    );
                });
                quickPick.onDidAccept(function () {
                    const selection = quickPick.selectedItems[0];
                    resolved = true;
                    log.push("accept");
                    resolve({ value: selection ? selection.value : undefined, log: log });
                    quickPick.hide();
                });
                quickPick.onDidHide(function () {
                    log.push("hide");
                    if (!resolved) resolve({ value: undefined, log: log });
                    quickPick.dispose();
                });
                quickPick.show();
                search("");
            });
        }),
        // Multi-select with pre-checked items, a separator and wizard steps.
        vscode.commands.registerCommand("test.pickManyObject", function () {
            return new Promise(function (resolve) {
                const quickPick = vscode.window.createQuickPick();
                const items = [
                    { label: "one" },
                    { label: "Group", kind: vscode.QuickPickItemKind.Separator },
                    { label: "two" },
                    { label: "three" },
                ];
                quickPick.title = "Pick numbers";
                quickPick.step = 1;
                quickPick.totalSteps = 2;
                quickPick.canSelectMany = true;
                quickPick.items = items;
                quickPick.selectedItems = [items[2]];
                quickPick.onDidAccept(function () {
                    const picked = quickPick.selectedItems.map(function (item) {
                        return item.label;
                    });
                    // The objects are the very ones the extension handed out: compared by reference.
                    const same = quickPick.selectedItems.every(function (item) {
                        return items.includes(item);
                    });
                    quickPick.dispose();
                    resolve({ picked: picked, same: same });
                });
                quickPick.show();
            });
        }),
        // Show and hide by the extension itself: onDidHide exactly once. Two
        // commands, not a timer: the test decides when the picker is already on screen.
        vscode.commands.registerCommand("test.showForHide", function () {
            const quickPick = vscode.window.createQuickPick();
            shown = { quickPick: quickPick, hides: 0 };
            quickPick.onDidHide(function () {
                shown.hides++;
            });
            quickPick.items = [{ label: "x" }];
            quickPick.show();
            return null;
        }),
        vscode.commands.registerCommand("test.hideShown", function () {
            const current = shown;
            return new Promise(function (resolve) {
                const subscription = current.quickPick.onDidHide(function () {
                    subscription.dispose();
                    // dispose after hiding must not produce a second onDidHide.
                    current.quickPick.dispose();
                    resolve({ hides: current.hides });
                });
                current.quickPick.hide();
            });
        }),
    );
};
