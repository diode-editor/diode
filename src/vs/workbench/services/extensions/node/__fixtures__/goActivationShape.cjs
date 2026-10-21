"use strict";

/**
 * Fixture for extensionHost.goActivationShape.test.ts: the `activate()` shape
 * of `golang.go` after the language server starts.
 *
 * In order, as in the stock extension: the debugger (configuration provider,
 * adapter and tracker factories, session subscriptions), Test API (controller, three
 * profiles by `TestRunProfileKind`, a test-file item in the collection), and
 * as the last step `languages.setLanguageConfiguration`. Without any of these
 * members `activate()` aborted, and the command registered after them
 * did not appear: running it is the observable "extension fully activated".
 */
const vscode = require("vscode");

exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider("go", {
            provideDebugConfigurations: function () {
                return [];
            },
        }),
        vscode.debug.registerDebugAdapterDescriptorFactory("go", {
            createDebugAdapterDescriptor: function () {
                return new vscode.DebugAdapterServer(4711);
            },
        }),
        vscode.debug.registerDebugAdapterTrackerFactory("*", { createDebugAdapterTracker: function () {} }),
        vscode.debug.onDidStartDebugSession(function () {}),
        vscode.debug.onDidTerminateDebugSession(function () {}),
    );

    const controller = vscode.tests.createTestController("go", "Go");
    context.subscriptions.push(controller);
    const kinds = [vscode.TestRunProfileKind.Run, vscode.TestRunProfileKind.Debug, vscode.TestRunProfileKind.Coverage];
    const profiles = kinds.map(function (kind) {
        return controller.createRunProfile("Go", kind, function () {}, true);
    });
    const file = controller.createTestItem("file:///w/a_test.go", "a_test.go", vscode.Uri.file("/w/a_test.go"));
    controller.items.add(file);
    file.children.add(controller.createTestItem("file:///w/a_test.go?test#TestA", "TestA"));

    context.subscriptions.push(
        vscode.languages.setLanguageConfiguration("gofixture", {
            wordPattern: /(-?\d*\.\d\w*)|([^`~!@#%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g,
            comments: { lineComment: { comment: "//", noIndent: true }, blockComment: ["/*", "*/"] },
            brackets: [["{", "}"]],
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("test.goActivationShape", async function () {
            const started = await vscode.debug.startDebugging(undefined, { type: "go", name: "x", request: "launch" });
            return {
                activeDebugSession: vscode.debug.activeDebugSession === undefined ? "none" : "some",
                started: started,
                profileKinds: profiles.map(function (profile) {
                    return profile.kind;
                }),
                found: controller.items.get("file:///w/a_test.go") === file,
                childParent: file.children.get("file:///w/a_test.go?test#TestA").parent === file,
                adapter: new vscode.DebugAdapterInlineImplementation({}).implementation !== undefined,
                symbol: new vscode.DocumentSymbol(
                    "TestA",
                    "",
                    vscode.SymbolKind.Function,
                    new vscode.Range(0, 0, 2, 1),
                    new vscode.Range(0, 5, 0, 10),
                ).children.length,
            };
        }),
    );
};
