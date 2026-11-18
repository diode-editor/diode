"use strict";

/**
 * Fixture for extensionHost.testingDebug.test.ts: a test controller whose Debug profile debugs its tests as
 * vitest.explorer does — the `runHandler` starts a `fixture-test-debug` session (the tiny inline adapter of
 * `../debugAdapters/dap.cjs`, stopped on entry) with the tests' ids in the launch configuration and reports them
 * passed when the session ends. Its Run profile only records that it ran. `test.testingDebug.seen` hands out the record.
 */
const { createAdapter } = require("../debugAdapters/dap.cjs");

const seen = [];

exports.activate = function activate(context) {
    const vscode = require("vscode");

    const controller = vscode.tests.createTestController("fixture-debug", "Fixture Debug");
    const file = vscode.Uri.file("/w/math.test.js");
    const adds = controller.createTestItem("adds", "adds", file);
    adds.range = new vscode.Range(1, 4, 3, 6);
    controller.items.add(adds);

    const leaves = (request) => {
        const tests = [];
        if (request.include === undefined) controller.items.forEach((item) => tests.push(item));
        else tests.push(...request.include);
        return tests;
    };

    controller.createRunProfile(
        "Run",
        vscode.TestRunProfileKind.Run,
        (request) => {
            seen.push(`run ${leaves(request).map((test) => test.id).join(",")}`);
        },
        true,
    );
    controller.createRunProfile(
        "Debug",
        vscode.TestRunProfileKind.Debug,
        async (request) => {
            const tests = leaves(request);
            const run = controller.createTestRun(request);
            for (const test of tests) run.started(test);
            const ended = new Promise((resolve) => {
                const listener = vscode.debug.onDidTerminateDebugSession((session) => {
                    if (session.type !== "fixture-test-debug") return;
                    listener.dispose();
                    resolve();
                });
            });
            const [folder] = vscode.workspace.workspaceFolders ?? [];
            const started = await vscode.debug.startDebugging(folder, {
                type: "fixture-test-debug",
                request: "launch",
                name: "Debug Tests",
                tests: tests.map((test) => test.id),
            });
            seen.push(`debug ${tests.map((test) => test.id).join(",")} started=${started}`);
            if (started) await ended;
            for (const test of tests) run.passed(test);
            run.end();
        },
        true,
    );

    context.subscriptions.push(
        controller,
        vscode.debug.registerDebugAdapterDescriptorFactory("fixture-test-debug", {
            createDebugAdapterDescriptor() {
                const emitter = new vscode.EventEmitter();
                return new vscode.DebugAdapterInlineImplementation({
                    onDidSendMessage: emitter.event,
                    handleMessage: createAdapter((message) => emitter.fire(message), "tests", () => undefined),
                    dispose: () => undefined,
                });
            },
        }),
        vscode.commands.registerCommand("test.testingDebug.seen", () => seen.slice()),
    );
};
