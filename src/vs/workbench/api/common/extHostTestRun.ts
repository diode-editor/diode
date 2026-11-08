import type * as vscode from "vscode";

import { RunOnceScheduler } from "../../../base/common/async.ts";
import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import { generateUuid } from "../../../base/common/uuid.ts";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { TestItemImpl, TestItemRootImpl, toWireTestItem } from "./extHostTestItem.ts";
import { rangeFrom } from "./extHostTypeConverters.ts";
import {
    type IWireTestItem,
    type IWireTestLocation,
    type IWireTestMessage,
    TEST_ID_DELIMITER,
    TestId,
    TestResultState,
} from "./testingWireTypes.ts";
import { CancellationTokenSource, EventEmitter } from "./vscodeTypes.ts";

// Upstream `TestRunTracker` and `TestRunCoordinator` (`api/common/extHostTesting.ts`): the `TestRun`s of one run
// report to the host under the run's id; a cancelled run ends its `TestRun`s itself after a deadline.

/** Upstream `RUN_CANCEL_DEADLINE`: after a cancellation the run's `TestRun`s are ended this much later. */
export const RUN_CANCEL_DEADLINE = 10_000;

/** Upstream `TestId.fromExtHostTestItem`: the path of ids from the controller down to the item. */
export function fullTestId(item: TestItemImpl, controllerId: string): string {
    const ids: string[] = [];
    for (let current: TestItemImpl | undefined = item; !(current instanceof TestItemRootImpl); ) {
        ids.unshift(current.id);
        current = TestItemImpl.apiOf(current).parent;
        if (current === undefined) break;
    }
    return [controllerId, ...ids].join(TEST_ID_DELIMITER);
}

/** Upstream `InvalidTestItemError`. */
function assertTestItem(test: vscode.TestItem): asserts test is TestItemImpl {
    if (!(test instanceof TestItemImpl)) {
        throw new Error(
            `TestItem with ID "${test.id}" is invalid. Make sure to create it from the createTestItem method.`,
        );
    }
}

function locationFrom(location: vscode.Location | undefined): IWireTestLocation | undefined {
    const range = rangeFrom(location?.range);
    // Stryker disable next-line ConditionalExpression: equivalent — rangeFrom(undefined) is null, a missing location takes the same branch
    return location === undefined || range === null ? undefined : { uri: location.uri.toString(), range };
}

/** Upstream `Convert.TestMessage.from`. */
function messageFrom(message: vscode.TestMessage, fallback: IWireTestLocation | undefined): IWireTestMessage {
    return {
        ...(typeof message.message === "string"
            ? { message: message.message }
            : { message: message.message.value, markdown: true }),
        expected: message.expectedOutput,
        actual: message.actualOutput,
        contextValue: message.contextValue,
        location: locationFrom(message.location) ?? fallback,
        stackTrace: message.stackTrace?.map((frame) => ({
            label: frame.label,
            uri: frame.uri?.toString(),
            position:
                frame.position === undefined
                    ? undefined
                    : { line: frame.position.line, character: frame.position.character },
        })),
    };
}

/** What a tracker knows of its controller. */
export interface ITestRunController {
    readonly controllerId: string;
    readonly root: TestItemRootImpl;
    /** A task's name when the extension gives none: upstream's extension display name, ours — the controller's label. */
    readonly defaultTaskName: string;
}

/** Upstream `TestRunTracker`: the `TestRun`s of one run of one controller. */
export class TestRunTracker {
    private running = 0;
    private readonly tasks = new Map<string, { readonly cts: CancellationTokenSource; readonly run: vscode.TestRun }>();
    /** Tests whose chain the host already has. */
    private readonly sharedTestIds = new Set<string>();
    private readonly cts = new CancellationTokenSource();
    private readonly forciblyEnd = new RunOnceScheduler(() => {
        this.forciblyEndTasks();
    }, RUN_CANCEL_DEADLINE);
    private readonly endEmitter = new EventEmitter<void>();
    private readonly disposeEmitter = new EventEmitter<void>();
    private readonly parentSubscription: { dispose(): void } | undefined;
    /**
     * Fires each time the last running `TestRun` ends; a handler may start another after that. Upstream fires it once,
     * and a request whose handler returned with such a later `TestRun` waits for it forever.
     */
    public readonly onEnd = this.endEmitter.event;

    public constructor(
        public readonly id: string,
        private readonly rpc: SubprocessRpc,
        private readonly controller: ITestRunController,
        parentToken?: ICancellationToken,
    ) {
        this.cts.token.onCancellationRequested(() => {
            this.forciblyEnd.schedule();
        });
        this.parentSubscription = parentToken?.onCancellationRequested(() => {
            this.cts.cancel();
        });
    }

    public get hasRunningTasks(): boolean {
        return this.running > 0;
    }

    /** Upstream `cancel`: the task's token, or the run's; the second cancel of the run ends its `TestRun`s now. */
    public cancel(taskId?: string): void {
        if (taskId !== undefined) {
            this.tasks.get(taskId)?.cts.cancel();
        } else if (!this.cts.token.isCancellationRequested) {
            this.cts.cancel();
        } else {
            // An ended run's `TestRun`s ignore `end()`.
            this.forciblyEndTasks();
        }
    }

    /** Upstream `createRun`: the extension's `TestRun`, a task of the run. */
    public createRun(name: string | undefined, persist: boolean): vscode.TestRun {
        const runId = this.id;
        const { controllerId } = this.controller;
        const taskId = generateUuid();
        const cts = new CancellationTokenSource();
        if (this.cts.token.isCancellationRequested) cts.cancel();
        const cancellation = this.cts.token.onCancellationRequested(() => {
            cts.cancel();
        });
        let ended = false;

        /** After `end()` a report is a no-op, as upstream (which also logs a warning). */
        const report =
            <Args extends unknown[]>(fn: (testId: string, ...args: Args) => void) =>
            (test: vscode.TestItem, ...args: Args): void => {
                if (ended) return;
                assertTestItem(test);
                fn(this.ensureTestIsKnown(test), ...args);
            };
        const setState = (testId: string, state: TestResultState, duration?: number): void => {
            this.rpc.notify("testing.updateTestStateInRun", { runId, taskId, testId, state, duration });
        };
        const appendMessages = (
            test: vscode.TestItem,
            testId: string,
            messages: vscode.TestMessage | readonly vscode.TestMessage[],
        ): void => {
            const list: readonly vscode.TestMessage[] = Array.isArray(messages) ? messages : [messages];
            const fallback =
                test.uri === undefined
                    ? undefined
                    : locationFrom({ uri: test.uri, range: test.range } as vscode.Location);
            this.rpc.notify("testing.appendTestMessagesInRun", {
                runId,
                taskId,
                testId,
                messages: list.map((message) => messageFrom(message, fallback)),
            });
        };
        const fail =
            (state: TestResultState) =>
            (
                test: vscode.TestItem,
                messages: vscode.TestMessage | readonly vscode.TestMessage[],
                duration?: number,
            ): void => {
                report((testId) => {
                    appendMessages(test, testId, messages);
                    setState(testId, state, duration);
                })(test);
            };

        const run: vscode.TestRun = {
            name,
            token: cts.token,
            isPersisted: persist,
            onDidDispose: this.disposeEmitter.event,
            enqueued: report((testId) => {
                setState(testId, TestResultState.Queued);
            }),
            started: report((testId) => {
                setState(testId, TestResultState.Running);
            }),
            skipped: report((testId) => {
                setState(testId, TestResultState.Skipped);
            }),
            passed: report((testId, duration?: number) => {
                setState(testId, TestResultState.Passed, duration);
            }),
            failed: fail(TestResultState.Failed),
            errored: fail(TestResultState.Errored),
            appendOutput: (output, location, test) => {
                if (ended) return;
                let testId: string | undefined;
                if (test !== undefined) {
                    assertTestItem(test);
                    testId = this.ensureTestIsKnown(test);
                }
                this.rpc.notify("testing.appendOutputToRun", {
                    runId,
                    taskId,
                    output,
                    location: locationFrom(location),
                    testId,
                });
            },
            // Coverage is a later wave: the reports are dropped.
            addCoverage: (): void => undefined,
            end: () => {
                if (ended) return;
                ended = true;
                // Stryker disable next-line CallExpression: hygiene — the ended task's token is not read any more, the link only leaks a listener
                cancellation.dispose();
                this.rpc.notify("testing.finishedTestRunTask", { runId, taskId });
                this.running--;
                if (this.running === 0) this.endEmitter.fire();
            },
        };

        this.running++;
        this.tasks.set(taskId, { run, cts });
        this.rpc.notify("testing.startedTestRunTask", {
            runId,
            taskId,
            controllerId,
            name: name ?? this.controller.defaultTaskName,
        });
        return run;
    }

    /** The host forgets the run: `onDidDispose` of its `TestRun`s fires. */
    public dispose(): void {
        this.forciblyEnd.dispose();
        this.parentSubscription?.dispose();
        this.disposeEmitter.fire();
        // Stryker disable BlockStatement,CallExpression: hygiene — the emitters of a forgotten run drop their listeners; nothing fires them any more
        this.disposeEmitter.dispose();
        this.endEmitter.dispose();
        // Stryker restore BlockStatement,CallExpression
    }

    private forciblyEndTasks(): void {
        for (const { run } of this.tasks.values()) run.end();
    }

    /** Upstream `ensureTestIsKnown`: the chain from the nearest known ancestor (or the root) goes first. */
    private ensureTestIsKnown(test: TestItemImpl): string {
        const { controllerId, root } = this.controller;
        const testId = fullTestId(test, controllerId);
        if (this.sharedTestIds.has(testId)) return testId;
        const chain: IWireTestItem[] = [];
        // The ancestors' ids are the test's id cut segment by segment.
        for (let current: TestItemImpl = test, extId: string | undefined = testId; ; ) {
            chain.unshift(toWireTestItem(current, extId));
            if (this.sharedTestIds.has(extId)) break;
            this.sharedTestIds.add(extId);
            extId = TestId.parentId(extId);
            // The root's id has no parent: the walk ends there.
            if (extId === undefined) break;
            current = TestItemImpl.apiOf(current).parent ?? root;
        }
        this.rpc.notify("testing.addTestsToRun", { controllerId, runId: this.id, tests: chain });
        return testId;
    }
}

/** Upstream `TestRunCoordinator`: ties `createTestRun(request)` to the run the host asked for with that request. */
export class TestRunCoordinator {
    private readonly tracked = new Map<vscode.TestRunRequest, TestRunTracker>();
    private readonly trackedById = new Map<string, TestRunTracker>();

    public constructor(private readonly rpc: SubprocessRpc) {}

    /** Upstream `prepareForMainThreadTestRun`: the caller drops the tracker when the request is answered. */
    public prepareForMainThreadTestRun(
        request: vscode.TestRunRequest,
        runId: string,
        controller: ITestRunController,
        token: ICancellationToken,
    ): TestRunTracker {
        return this.track(request, new TestRunTracker(runId, this.rpc, controller, token));
    }

    /** Upstream `disposeTestRun`. */
    public disposeTestRun(tracker: TestRunTracker): void {
        tracker.dispose();
        // Stryker disable next-line ConditionalExpression,CallExpression: hygiene — a forgotten run's entry only leaks; a cancel of its id reaches a disposed tracker, which ends nothing
        if (this.trackedById.get(tracker.id) === tracker) this.trackedById.delete(tracker.id);
        for (const [request, other] of this.tracked) {
            if (other === tracker) this.tracked.delete(request);
        }
    }

    public cancelRunById(runId: string, taskId?: string): void {
        this.trackedById.get(runId)?.cancel(taskId);
    }

    public cancelAllRuns(): void {
        for (const tracker of this.tracked.values()) tracker.cancel();
    }

    /**
     * Upstream `createTestRun`: a task of the host's run with this request, otherwise a run of the extension's own
     * (`testing.startedExtensionTestRun`), finished and forgotten when its last `TestRun` ends.
     */
    public createTestRun(
        controller: ITestRunController,
        request: vscode.TestRunRequest,
        profileId: number | null,
        name: string | undefined,
        persist: boolean,
    ): vscode.TestRun {
        const existing = this.tracked.get(request);
        if (existing !== undefined) return existing.createRun(name, persist);

        const runId = generateUuid();
        const { controllerId, root } = controller;
        const idOf = (test: vscode.TestItem): string => {
            assertTestItem(test);
            return fullTestId(test, controllerId);
        };
        this.rpc.notify("testing.startedExtensionTestRun", {
            runId,
            controllerId,
            include: request.include?.map(idOf) ?? [root.id],
            exclude: request.exclude?.map(idOf) ?? [],
            profileId,
            preserveFocus: request.preserveFocus,
            persist,
            continuous: request.continuous === true,
        });
        const tracker = this.track(request, new TestRunTracker(runId, this.rpc, controller));
        tracker.onEnd(() => {
            this.rpc.notify("testing.finishedExtensionTestRun", { runId });
            this.disposeTestRun(tracker);
        });
        return tracker.createRun(name, persist);
    }

    private track(request: vscode.TestRunRequest, tracker: TestRunTracker): TestRunTracker {
        this.tracked.set(request, tracker);
        this.trackedById.set(tracker.id, tracker);
        return tracker;
    }
}
