"use strict";

/**
 * Fixture for extensionHost.testing.test.ts: a vitest-explorer-shaped controller. The root resolves to one
 * file, the file to a suite with two tests; a refresh waits for `finishRefresh` or its token; three profiles,
 * one of each kind. A file's resolve waits for `finishResolve`. The `test.testing.*` commands drive it and report what the extension saw.
 */
const vscode = require("vscode");

exports.activate = function activate(context) {
    const events = [];
    let failResolve = false;
    let finishRefresh = function () {};
    let finishResolve = function () {};
    const controller = vscode.tests.createTestController("fixture", "Fixture");
    controller.resolveHandler = async function (item) {
        events.push("resolve:" + (item === undefined ? "<root>" : item.id));
        if (failResolve) throw new Error("resolve exploded");
        if (item === undefined) {
            const file = controller.createTestItem("math.test.ts", "math.test.ts", vscode.Uri.file("/w/math.test.ts"));
            file.canResolveChildren = true;
            controller.items.add(file);
            return;
        }
        await new Promise(function (resolve) {
            finishResolve = resolve;
        });
        const suite = controller.createTestItem("math", "math", item.uri);
        suite.range = new vscode.Range(0, 0, 9, 2);
        const adds = controller.createTestItem("adds", "adds", item.uri);
        adds.range = new vscode.Range(1, 4, 3, 6);
        suite.children.replace([adds, controller.createTestItem("subtracts", "subtracts", item.uri)]);
        item.children.add(suite);
    };
    controller.refreshHandler = function (token) {
        events.push("refresh");
        return new Promise(function (resolve) {
            finishRefresh = function () {
                events.push("refresh:done");
                resolve();
            };
            token.onCancellationRequested(function () {
                events.push("refresh:cancelled");
                resolve();
            });
        });
    };
    const run = function () {
        events.push("run");
    };
    const profiles = [
        controller.createRunProfile("Run Tests", vscode.TestRunProfileKind.Run, run, true),
        controller.createRunProfile("Debug Tests", vscode.TestRunProfileKind.Debug, run),
        controller.createRunProfile("Run Tests with Coverage", vscode.TestRunProfileKind.Coverage, run),
    ];
    context.subscriptions.push(
        controller,
        vscode.commands.registerCommand("test.testing.state", function () {
            return events;
        }),
        vscode.commands.registerCommand("test.testing.failResolve", function () {
            failResolve = true;
            controller.items.get("math.test.ts").canResolveChildren = false;
            const other = controller.createTestItem("other.test.ts", "other.test.ts");
            other.canResolveChildren = true;
            controller.items.add(other);
        }),
        vscode.commands.registerCommand("test.testing.rename", function () {
            controller.items.get("math.test.ts").label = "renamed.test.ts";
            controller.label = "Renamed";
        }),
        vscode.commands.registerCommand("test.testing.removeFile", function () {
            controller.items.delete("math.test.ts");
        }),
        vscode.commands.registerCommand("test.testing.finishResolve", function () {
            finishResolve();
        }),
        vscode.commands.registerCommand("test.testing.finishRefresh", function () {
            finishRefresh();
        }),
        vscode.commands.registerCommand("test.testing.editRunProfile", function () {
            profiles[1].label = "Debug Everything";
            profiles[1].isDefault = true;
        }),
        vscode.commands.registerCommand("test.testing.disposeRunProfile", function () {
            profiles[0].dispose();
        }),
        vscode.commands.registerCommand("test.testing.dispose", function () {
            controller.dispose();
        }),
        // Kills its own process to model an extension crash; deferred by a tick so the RPC reply gets out.
        vscode.commands.registerCommand("test.testing.kill", function () {
            setTimeout(function () {
                process.exit(1);
            }, 10);
            return "dying";
        }),
    );
};
