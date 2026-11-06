import { afterEach, describe, expect, it, vi } from "vitest";
import type * as vscodeTypes from "vscode";

import { testId } from "../../../../TestUtils/testTree.ts";
import { CancellationTokenSource } from "../../../base/common/cancellation.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { TestItemImpl } from "./extHostTestItem.ts";
import { fullTestId, RUN_CANCEL_DEADLINE } from "./extHostTestRun.ts";
import { TestResultState } from "./testingWireTypes.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

// Upstream `runControllerTestRequest`, `TestRunTracker` and `TestRunCoordinator`: what the host sees of a run.

type Stub = ReturnType<typeof makeStubRpc>;

function makeVscode() {
    const stub = makeStubRpc();
    const { namespace } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());
    return { stub, vscode: namespace };
}

/** Run messages as `method params`, the uuid task id replaced by `T<n>`. */
function runMessages(stub: Stub): unknown[] {
    const tasks: string[] = [];
    return stub.notifies
        .filter((n) => n.method.startsWith("testing.") && !/Controller|Diff|Profile/.test(n.method))
        .map((n) => {
            const params = { ...(n.params as Record<string, unknown>) };
            if (typeof params.taskId === "string") {
                if (!tasks.includes(params.taskId)) tasks.push(params.taskId);
                params.taskId = `T${String(tasks.indexOf(params.taskId))}`;
            }
            return [n.method.slice("testing.".length), params];
        });
}

/** `math` with `adds` and `fails` under `ctrl`, a Run profile with `handler`. */
function setup(handler: (request: vscodeTypes.TestRunRequest, token: vscodeTypes.CancellationToken) => unknown) {
    const env = makeVscode();
    const controller = env.vscode.tests.createTestController("ctrl", "Ctrl");
    const uri = env.vscode.Uri.file("/w/math.test.ts");
    const math = controller.createTestItem("math", "math", uri);
    const adds = controller.createTestItem("adds", "adds", uri);
    adds.range = new env.vscode.Range(1, 4, 1, 20);
    const fails = controller.createTestItem("fails", "fails", uri);
    math.children.add(adds);
    math.children.add(fails);
    controller.items.add(math);
    const profile = controller.createRunProfile(
        "Run",
        env.vscode.TestRunProfileKind.Run,
        (request, token) => handler(request, token) as Thenable<void> | void,
    );
    const profileId = (profile as unknown as { profileId: number }).profileId;
    const run = (testIds: string[], token = new CancellationTokenSource().token, excludeExtIds: string[] = []) =>
        env.stub.callRequest(
            "testing.runControllerTests",
            { requests: [{ runId: "r1", controllerId: "ctrl", profileId, testIds, excludeExtIds }] },
            token,
        );
    return { ...env, controller, math, adds, fails, profile, profileId, run };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("vscode.tests — a run the core asks for", () => {
    it("[api:tests.createTestController] runHandler gets the request; createTestRun of it reports under the core's run id", async () => {
        const seen: vscodeTypes.TestRunRequest[] = [];
        const env = setup((request) => {
            seen.push(request);
            const run = env.controller.createTestRun(request);
            run.enqueued(env.adds);
            run.started(env.adds);
            run.passed(env.adds, 12);
            run.failed(env.fails, new env.vscode.TestMessage("boom"), 3);
            run.appendOutput("hello\r\n", undefined, env.adds);
            run.end();
        });
        await expect(env.run([testId("ctrl", "math")])).resolves.toEqual([{}]);
        expect(seen).toHaveLength(1);
        expect(seen[0].include).toEqual([env.math]);
        expect(seen[0].exclude).toEqual([]);
        expect(seen[0].profile).toBe(env.profile);
        expect(seen[0].continuous).toBe(false);
        const adds = testId("ctrl", "math", "adds");
        const fails = testId("ctrl", "math", "fails");
        expect(runMessages(env.stub)).toEqual([
            ["startedTestRunTask", { runId: "r1", taskId: "T0", controllerId: "ctrl", name: "Ctrl" }],
            [
                "addTestsToRun",
                {
                    controllerId: "ctrl",
                    runId: "r1",
                    tests: [
                        expect.objectContaining({ extId: "ctrl", label: "Ctrl" }),
                        expect.objectContaining({ extId: testId("ctrl", "math"), label: "math" }),
                        expect.objectContaining({ extId: adds, label: "adds" }),
                    ],
                },
            ],
            [
                "updateTestStateInRun",
                { runId: "r1", taskId: "T0", testId: adds, state: TestResultState.Queued, duration: undefined },
            ],
            [
                "updateTestStateInRun",
                { runId: "r1", taskId: "T0", testId: adds, state: TestResultState.Running, duration: undefined },
            ],
            [
                "updateTestStateInRun",
                { runId: "r1", taskId: "T0", testId: adds, state: TestResultState.Passed, duration: 12 },
            ],
            // The known ancestor starts the chain.
            [
                "addTestsToRun",
                {
                    controllerId: "ctrl",
                    runId: "r1",
                    tests: [
                        expect.objectContaining({ extId: testId("ctrl", "math") }),
                        expect.objectContaining({ extId: fails }),
                    ],
                },
            ],
            [
                "appendTestMessagesInRun",
                {
                    runId: "r1",
                    taskId: "T0",
                    testId: fails,
                    // `fails` has no range: no default location.
                    messages: [
                        {
                            message: "boom",
                            expected: undefined,
                            actual: undefined,
                            contextValue: undefined,
                            location: undefined,
                            stackTrace: undefined,
                        },
                    ],
                },
            ],
            [
                "updateTestStateInRun",
                { runId: "r1", taskId: "T0", testId: fails, state: TestResultState.Failed, duration: 3 },
            ],
            [
                "appendOutputToRun",
                { runId: "r1", taskId: "T0", output: "hello\r\n", location: undefined, testId: adds },
            ],
            ["finishedTestRunTask", { runId: "r1", taskId: "T0" }],
        ]);
    });

    it("[api:tests.createTestController] the root runs everything: include is undefined; only exclusions under an included test pass", async () => {
        const seen: vscodeTypes.TestRunRequest[] = [];
        const env = setup((request) => {
            seen.push(request);
        });
        const other = env.controller.createTestItem("other", "other");
        env.controller.items.add(other);
        await env.run(["ctrl"], undefined, [testId("ctrl", "math", "fails"), "ctrl\0gone"]);
        await env.run([testId("ctrl", "math")], undefined, [testId("ctrl", "other"), testId("ctrl", "math", "adds")]);
        expect(seen[0].include).toBeUndefined();
        expect(seen[0].exclude).toEqual([env.fails]);
        expect(seen[1].include).toEqual([env.math]);
        expect(seen[1].exclude).toEqual([env.adds]);
        // A handler that never creates a run answers at once.
        expect(runMessages(env.stub)).toEqual([]);
    });

    it("[api:tests.createTestController] an unknown controller, profile or test answers empty without calling the handler", async () => {
        const handler = vi.fn();
        const env = setup(handler);
        const req = {
            runId: "r",
            controllerId: "ctrl",
            profileId: env.profileId,
            testIds: ["ctrl\0gone"],
            excludeExtIds: [],
        };
        await expect(
            env.stub.callRequest("testing.runControllerTests", {
                requests: [
                    req,
                    { ...req, controllerId: "nope" },
                    { ...req, profileId: env.profileId + 1, testIds: ["ctrl"] },
                ],
            }),
        ).resolves.toEqual([{}, {}, {}]);
        expect(handler).not.toHaveBeenCalled();
    });

    it("[api:tests.createTestController] a throwing or rejecting runHandler answers its error as text", async () => {
        const env = setup(() => {
            throw new Error("no vitest");
        });
        await expect(env.run(["ctrl"])).resolves.toEqual([{ error: "Error: no vitest" }]);
        const rejecting = setup(() => Promise.reject(new Error("later")));
        await expect(rejecting.run(["ctrl"])).resolves.toEqual([{ error: "Error: later" }]);
    });

    it("[api:tests.createTestController] the answer waits for the run's TestRuns to end after the handler resolved", async () => {
        let run: vscodeTypes.TestRun | undefined;
        let second: vscodeTypes.TestRun | undefined;
        const env = setup((request) => {
            run = env.controller.createTestRun(request, "vitest");
            run.started(env.adds);
            // A second TestRun of the same request is a second task of the same run.
            second = env.controller.createTestRun(request);
            second.end();
        });
        let answered = false;
        const answer = env.run(["ctrl"]).then(() => {
            answered = true;
        });
        await vi.waitFor(() => {
            expect(run).toBeDefined();
        });
        await Promise.resolve();
        expect(answered).toBe(false);
        expect(second).toBeDefined();
        run?.end();
        await answer;
        expect(answered).toBe(true);
        const ended = vi.fn();
        run?.onDidDispose(ended);
        // Reports after end are no-ops.
        const before = env.stub.notifies.length;
        run?.passed(env.adds);
        run?.appendOutput("late");
        run?.end();
        expect(env.stub.notifies.slice(before)).toEqual([]);
        expect(ended).not.toHaveBeenCalled();
        const tasks = sentParams(env.stub, "testing.startedTestRunTask") as { runId: string; name: string }[];
        expect(tasks.map((task) => [task.runId, task.name])).toEqual([
            ["r1", "vitest"],
            ["r1", "Ctrl"],
        ]);
        expect(sentParams(env.stub, "testing.startedExtensionTestRun")).toEqual([]);
    });
});

describe("vscode.tests — cancelling a run", () => {
    it("[api:tests.createTestController] the request's token cancels the handler's and the TestRun's tokens; the run ends itself after the deadline", async () => {
        vi.useFakeTimers();
        let run: vscodeTypes.TestRun | undefined;
        let handlerToken: vscodeTypes.CancellationToken | undefined;
        const env = setup((request, token) => {
            handlerToken = token;
            run = env.controller.createTestRun(request);
            run.started(env.adds);
        });
        const cts = new CancellationTokenSource();
        const answer = env.run(["ctrl"], cts.token);
        await vi.advanceTimersByTimeAsync(0);
        expect(run?.token.isCancellationRequested).toBe(false);
        cts.cancel();
        expect(handlerToken?.isCancellationRequested).toBe(true);
        expect(run?.token.isCancellationRequested).toBe(true);
        // The extension does not end its run: the deadline does, and then the request answers.
        let answered = false;
        void answer.then(() => {
            answered = true;
        });
        await vi.advanceTimersByTimeAsync(RUN_CANCEL_DEADLINE - 1);
        expect(answered).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(answered).toBe(true);
        expect(runMessages(env.stub).map((m) => (m as [string])[0])).toEqual([
            "startedTestRunTask",
            "addTestsToRun",
            "updateTestStateInRun",
            "finishedTestRunTask",
        ]);
    });

    it("[api:tests.createTestController] a handler still running when cancelled answers as soon as it settles", async () => {
        let finish = (): void => undefined;
        const env = setup((request) => {
            env.controller.createTestRun(request).started(env.adds);
            return new Promise<void>((resolve) => {
                finish = resolve;
            });
        });
        const cts = new CancellationTokenSource();
        const answer = env.run(["ctrl"], cts.token);
        await vi.waitFor(() => {
            expect(sentParams(env.stub, "testing.startedTestRunTask")).toHaveLength(1);
        });
        cts.cancel();
        finish();
        await expect(answer).resolves.toEqual([{}]);
        expect(sentParams(env.stub, "testing.finishedTestRunTask")).toEqual([]);
    });

    it("[api:tests.createTestController] cancelExtensionTestRun cancels the TestRun's token; past the deadline the run ends; a second cancel ends it at once", async () => {
        vi.useFakeTimers();
        const runs: vscodeTypes.TestRun[] = [];
        const env = setup((request) => {
            runs.push(env.controller.createTestRun(request));
        });
        const first = env.run(["ctrl"]);
        await vi.advanceTimersByTimeAsync(0);
        env.stub.fire("testing.cancelExtensionTestRun", { runId: "other" });
        expect(runs[0].token.isCancellationRequested).toBe(false);
        env.stub.fire("testing.cancelExtensionTestRun", { runId: "r1" });
        expect(runs[0].token.isCancellationRequested).toBe(true);
        await vi.advanceTimersByTimeAsync(RUN_CANCEL_DEADLINE - 1);
        expect(env.stub.notifies.some((n) => n.method === "testing.finishedTestRunTask")).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await first;
        expect(env.stub.notifies.filter((n) => n.method === "testing.finishedTestRunTask")).toHaveLength(1);

        const second = env.run(["ctrl"]);
        await vi.advanceTimersByTimeAsync(0);
        env.stub.fire("testing.cancelExtensionTestRun", {});
        expect(runs[1].token.isCancellationRequested).toBe(true);
        env.stub.fire("testing.cancelExtensionTestRun", {});
        await second;
        expect(env.stub.notifies.filter((n) => n.method === "testing.finishedTestRunTask")).toHaveLength(2);
    });

    it("[api:tests.createTestController] a task's id cancels that TestRun only", async () => {
        const runs: vscodeTypes.TestRun[] = [];
        let finish = (): void => undefined;
        const env = setup((request) => {
            runs.push(env.controller.createTestRun(request), env.controller.createTestRun(request));
            return new Promise<void>((resolve) => {
                finish = resolve;
            });
        });
        const answer = env.run(["ctrl"]);
        await vi.waitFor(() => {
            expect(runs).toHaveLength(2);
        });
        const [firstTask] = env.stub.notifies
            .filter((n) => n.method === "testing.startedTestRunTask")
            .map((n) => (n.params as { taskId: string }).taskId);
        env.stub.fire("testing.cancelExtensionTestRun", { runId: "r1", taskId: firstTask });
        expect(runs.map((run) => run.token.isCancellationRequested)).toEqual([true, false]);
        for (const run of runs) run.end();
        finish();
        await answer;
    });
});

describe("vscode.tests — a run the extension starts", () => {
    it("[api:tests.createTestController] createTestRun without the core's request starts a run of its own and finishes it with the last TestRun", () => {
        const env = setup(() => undefined);
        const request = new env.vscode.TestRunRequest([env.adds], [env.fails], env.profile, false, false);
        const run = env.controller.createTestRun(request, "watch");
        const again = env.controller.createTestRun(request);
        const [started] = runMessages(env.stub) as [string, { runId: string }][];
        expect(started).toEqual([
            "startedExtensionTestRun",
            {
                runId: expect.any(String) as string,
                controllerId: "ctrl",
                include: [testId("ctrl", "math", "adds")],
                exclude: [testId("ctrl", "math", "fails")],
                profileId: env.profileId,
                preserveFocus: false,
                persist: true,
                continuous: false,
            },
        ]);
        const { runId } = started[1];
        const ended = vi.fn();
        run.onDidDispose(ended);
        run.end();
        expect(env.stub.notifies.some((n) => n.method === "testing.finishedExtensionTestRun")).toBe(false);
        again.end();
        expect(sentParams(env.stub, "testing.finishedExtensionTestRun")).toEqual([{ runId }]);
        expect(ended).toHaveBeenCalledTimes(1);
        // The request is forgotten: the next TestRun of it is a new run.
        env.controller.createTestRun(request, undefined, false);
        const runs = sentParams(env.stub, "testing.startedExtensionTestRun") as { runId: string; persist: boolean }[];
        expect(runs).toHaveLength(2);
        expect(runs[1].runId).not.toBe(runId);
        expect(runs[1].persist).toBe(false);
    });

    it("[api:tests.createTestController] a request without include runs the root; without a profile its id is null", () => {
        const env = setup(() => undefined);
        env.controller.createTestRun(new env.vscode.TestRunRequest());
        expect(sentParams(env.stub, "testing.startedExtensionTestRun")).toEqual([
            expect.objectContaining({
                include: ["ctrl"],
                exclude: [],
                profileId: null,
                preserveFocus: true,
                continuous: false,
            }),
        ]);
    });

    it("[api:tests.createTestController] a profile or a test from elsewhere throws, as upstream", () => {
        const env = setup(() => undefined);
        const foreignProfile = { kind: 1 } as unknown as vscodeTypes.TestRunProfile;
        expect(() =>
            env.controller.createTestRun(new env.vscode.TestRunRequest(undefined, undefined, foreignProfile)),
        ).toThrow("TestRunRequest.profile is not an instance created from TestController.createRunProfile");
        const run = env.controller.createTestRun(new env.vscode.TestRunRequest());
        const fake = { id: "fake" } as vscodeTypes.TestItem;
        expect(() => {
            run.passed(fake);
        }).toThrow('TestItem with ID "fake" is invalid');
        expect(() => {
            run.appendOutput("x", undefined, fake);
        }).toThrow('TestItem with ID "fake" is invalid');
        expect(() => env.controller.createTestRun(new env.vscode.TestRunRequest([fake]))).toThrow("is invalid");
    });

    it("[api:tests.createTestController] messages carry markdown as text, diffs, stack frames and the test's location by default", () => {
        const env = setup(() => undefined);
        const run = env.controller.createTestRun(new env.vscode.TestRunRequest());
        const diff = env.vscode.TestMessage.diff(new env.vscode.MarkdownString("**not equal**"), "2", "3");
        diff.contextValue = "ctx";
        diff.stackTrace = [
            new env.vscode.TestMessageStackFrame(
                "at adds",
                env.vscode.Uri.file("/w/a.ts"),
                new env.vscode.Position(4, 2),
            ),
            new env.vscode.TestMessageStackFrame("native"),
        ];
        const located = new env.vscode.TestMessage("here");
        located.location = new env.vscode.Location(env.vscode.Uri.file("/w/b.ts"), new env.vscode.Range(7, 0, 7, 1));
        run.errored(env.adds, [diff, located], 5);
        run.appendOutput(
            "at\n",
            new env.vscode.Location(env.vscode.Uri.file("/w/c.ts"), new env.vscode.Range(0, 0, 0, 1)),
        );
        const range = (line: number, from: number, to: number) => ({
            start: { line, character: from },
            end: { line, character: to },
        });
        expect(sentParams(env.stub, "testing.appendTestMessagesInRun")).toEqual([
            {
                runId: expect.any(String) as string,
                taskId: expect.any(String) as string,
                testId: testId("ctrl", "math", "adds"),
                messages: [
                    {
                        message: "**not equal**",
                        expected: "2",
                        actual: "3",
                        contextValue: "ctx",
                        location: { uri: "file:///w/math.test.ts", range: range(1, 4, 20) },
                        stackTrace: [
                            { label: "at adds", uri: "file:///w/a.ts", position: { line: 4, character: 2 } },
                            { label: "native", uri: undefined, position: undefined },
                        ],
                    },
                    expect.objectContaining({
                        message: "here",
                        location: { uri: "file:///w/b.ts", range: range(7, 0, 1) },
                    }),
                ],
            },
        ]);
        expect(sentParams(env.stub, "testing.updateTestStateInRun")).toEqual([
            expect.objectContaining({ state: TestResultState.Errored, duration: 5 }),
        ]);
        expect(sentParams(env.stub, "testing.appendOutputToRun")).toEqual([
            expect.objectContaining({
                output: "at\n",
                location: { uri: "file:///w/c.ts", range: range(0, 0, 1) },
                testId: undefined,
            }),
        ]);
        run.skipped(env.fails);
        expect(sentParams(env.stub, "testing.updateTestStateInRun")[1]).toMatchObject({
            state: TestResultState.Skipped,
        });
    });
});

describe("TestRunTracker — edges", () => {
    it("a request cancelled before the handler runs hands it cancelled tokens; a cancel after the end does nothing", async () => {
        const seen: boolean[] = [];
        const env = setup((request, token) => {
            const run = env.controller.createTestRun(request);
            seen.push(token.isCancellationRequested, run.token.isCancellationRequested);
            run.end();
        });
        const cts = new CancellationTokenSource();
        cts.cancel();
        await env.run(["ctrl"], cts.token);
        expect(seen).toEqual([true, true]);
        // An extension's own run: ended, then cancelled twice — no second end.
        const own = env.controller.createTestRun(new env.vscode.TestRunRequest());
        const [{ runId }] = sentParams(env.stub, "testing.startedExtensionTestRun") as { runId: string }[];
        own.end();
        env.stub.fire("testing.cancelExtensionTestRun", { runId });
        env.stub.fire("testing.cancelExtensionTestRun", { runId });
        expect(sentParams(env.stub, "testing.finishedTestRunTask")).toHaveLength(2);
    });

    it("a cancel after the run's TestRuns ended, while the handler still runs, ends nothing again", async () => {
        let finish = (): void => undefined;
        const env = setup((request) => {
            env.controller.createTestRun(request).end();
            return new Promise<void>((resolve) => {
                finish = resolve;
            });
        });
        const answer = env.run(["ctrl"]);
        await vi.waitFor(() => {
            expect(sentParams(env.stub, "testing.finishedTestRunTask")).toHaveLength(1);
        });
        env.stub.fire("testing.cancelExtensionTestRun", { runId: "r1" });
        env.stub.fire("testing.cancelExtensionTestRun", { runId: "r1" });
        finish();
        await answer;
        expect(sentParams(env.stub, "testing.finishedTestRunTask")).toHaveLength(1);
    });

    it("a second run of the core under the same id keeps the newer one cancellable", async () => {
        const runs: vscodeTypes.TestRun[] = [];
        const finishers: (() => void)[] = [];
        const env = setup((request) => {
            runs.push(env.controller.createTestRun(request));
            return new Promise<void>((resolve) => {
                finishers.push(resolve);
            });
        });
        const first = env.run(["ctrl"]);
        const second = env.run(["ctrl"]);
        await vi.waitFor(() => {
            expect(runs).toHaveLength(2);
        });
        runs[0].end();
        finishers[0]();
        await first;
        env.stub.fire("testing.cancelExtensionTestRun", { runId: "r1" });
        expect(runs[1].token.isCancellationRequested).toBe(true);
        runs[1].end();
        finishers[1]();
        await second;
    });
});

describe("fullTestId", () => {
    it("is the path of ids from the controller; a detached item hangs off the root", () => {
        const { vscode } = makeVscode();
        const controller = vscode.tests.createTestController("ctrl", "Ctrl");
        const file = controller.createTestItem("f", "F");
        const test = controller.createTestItem("t", "T");
        expect(fullTestId(test as TestItemImpl, "ctrl")).toBe(testId("ctrl", "t"));
        controller.items.add(file);
        file.children.add(test);
        expect(fullTestId(test as TestItemImpl, "ctrl")).toBe(testId("ctrl", "f", "t"));
    });
});

function sentParams(stub: Stub, method: string): unknown[] {
    return stub.notifies.filter((n) => n.method === method).map((n) => n.params);
}
