import { Emitter, type Event } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import {
    type IWireTestItem,
    type IWireTestLocation,
    type IWireTestMessage,
    TestId,
    TestResultState,
    type TestRunProfileGroup,
} from "../../../api/common/testingWireTypes.ts";

import {
    computeState,
    makeEmptyCounts,
    maxPriority,
    terminalStatePriorities,
    type TestStateCount,
} from "./testingStates.ts";

// Upstream `LiveTestResult` (`contrib/testing/common/testResult.ts`): one run's tests with the states its tasks
// reported, the messages and the output; the TEST RESULTS panel shows them.

/** Upstream `ResolvedTestRunRequest`: what was asked to run, by controller and profile. */
export interface IResolvedTestRunRequest {
    readonly targets: readonly {
        readonly controllerId: string;
        readonly profileId: number;
        readonly testIds: readonly string[];
    }[];
    readonly group: TestRunProfileGroup;
    readonly exclude?: readonly string[];
    readonly preserveFocus?: boolean;
    readonly continuous?: boolean;
}

/** Upstream `ITestOutputMessage`, without the terminal marks: the start of the output and where it is. */
export interface ITestOutputMessage {
    readonly type: "output";
    /** Upstream's preview: the first 100 characters. */
    readonly message: string;
    readonly offset: number;
    readonly length: number;
    readonly location?: IWireTestLocation;
}

export type ITestResultMessage = ({ readonly type: "error" } & IWireTestMessage) | ITestOutputMessage;

/** Upstream `ITestTaskState`. */
export interface ITestTaskState {
    state: TestResultState;
    duration?: number;
    readonly messages: ITestResultMessage[];
}

/** Upstream `TestResultItem`: a test of the run. */
export interface ITestResultItem {
    readonly controllerId: string;
    readonly item: IWireTestItem;
    /** One per task of the run, in task order. */
    readonly tasks: readonly ITestTaskState[];
    /** The highest priority of the tasks' states. */
    readonly ownComputedState: TestResultState;
    readonly ownDuration: number | undefined;
    /** The own state raised by the children's in this run. */
    readonly computedState: TestResultState;
}

interface IMutableResultItem extends ITestResultItem {
    readonly tasks: ITestTaskState[];
    ownComputedState: TestResultState;
    ownDuration: number | undefined;
    computedState: TestResultState;
    readonly children: IMutableResultItem[];
}

/** Upstream `ITestRunTaskResults`. */
export interface ITestRunTaskResults {
    readonly id: string;
    readonly name: string;
    readonly ctrlId: string;
    readonly running: boolean;
    /** The raw output, as the extension appended it. */
    readonly output: string;
    /** Output that belongs to no test. */
    readonly otherMessages: readonly ITestResultMessage[];
}

interface IMutableTask extends ITestRunTaskResults {
    running: boolean;
    output: string;
    readonly otherMessages: ITestResultMessage[];
}

/** Upstream `TestResultItemChange`: an own state, a state raised by a child, or a new message. */
export interface ITestResultItemChange {
    readonly item: ITestResultItem;
    readonly result: LiveTestResult;
    readonly reason: "ownState" | "computedState" | "message";
}

/** Upstream `task.output.onDidWriteData` with the test of the chunk, if any. */
export interface ITestOutputAppend {
    readonly taskIndex: number;
    readonly output: string;
    readonly testId: string | undefined;
}

const PREVIEW_LENGTH = 100;

/** Upstream `LiveTestResult`: created when the run starts, marked complete when it ends. */
export class LiveTestResult extends Disposable {
    public readonly startedAt: number;
    public readonly counts: TestStateCount = makeEmptyCounts();
    private readonly testById = new Map<string, IMutableResultItem>();
    private readonly taskList: IMutableTask[] = [];
    private completedAtValue: number | undefined;
    private readonly changeEmitter = this.register(new Emitter<ITestResultItemChange>());
    private readonly completeEmitter = this.register(new Emitter<void>());
    private readonly newTaskEmitter = this.register(new Emitter<number>());
    private readonly endTaskEmitter = this.register(new Emitter<number>());
    private readonly outputEmitter = this.register(new Emitter<ITestOutputAppend>());
    public readonly onChange: Event<ITestResultItemChange> = this.changeEmitter.event;
    public readonly onComplete: Event<void> = this.completeEmitter.event;
    /** Upstream `onNewTask`: the index of the added task. */
    public readonly onNewTask: Event<number> = this.newTaskEmitter.event;
    /** Upstream `onEndTask`: the index of the task that completed. */
    public readonly onEndTask: Event<number> = this.endTaskEmitter.event;
    public readonly onDidAppendOutput: Event<ITestOutputAppend> = this.outputEmitter.event;
    /** Upstream `name`: "Test run at {0}" with the start's local date and time. */
    public readonly name: string;

    /** Upstream's `persist` decides what goes to the storage; results here live in memory only. */
    public constructor(
        public readonly id: string,
        public readonly request: IResolvedTestRunRequest,
        /** Upstream `insertOrder`: completed results sort by it, the latest first. */
        public readonly insertOrder: number,
        private readonly now: () => number = Date.now,
    ) {
        super();
        this.startedAt = now();
        this.name = `Test run at ${new Date(this.startedAt).toLocaleString()}`;
    }

    /** `undefined` while the run goes on. */
    public get completedAt(): number | undefined {
        return this.completedAtValue;
    }

    public get tasks(): readonly ITestRunTaskResults[] {
        return this.taskList;
    }

    public get tests(): IterableIterator<ITestResultItem> {
        return this.testById.values();
    }

    public getStateById(testId: string): ITestResultItem | undefined {
        return this.testById.get(testId);
    }

    /** Upstream `addTask`: every test of the run gets an `Unset` state in it. */
    public addTask(task: { readonly id: string; readonly name: string; readonly ctrlId: string }): void {
        this.taskList.push({ ...task, running: true, output: "", otherMessages: [] });
        for (const test of this.testById.values()) test.tasks.push({ state: TestResultState.Unset, messages: [] });
        this.newTaskEmitter.fire(this.taskList.length - 1);
    }

    /** Upstream `addTestChainToRun`: the first test of the chain is a root or a test the run knows. */
    public addTestChainToRun(controllerId: string, chain: readonly IWireTestItem[]): void {
        let parent: IMutableResultItem | undefined;
        for (const item of chain)
            parent = this.testById.get(item.extId) ?? this.addTestToRun(controllerId, item, parent);
    }

    /** Upstream `updateState`: a terminal state is not replaced by a lower one or by a non-terminal one. */
    public updateState(testId: string, taskId: string, state: TestResultState, duration?: number): void {
        const entry = this.testById.get(testId);
        const index = this.taskIndex(taskId);
        if (entry === undefined || index === -1) return;
        const oldTerminal = terminalStatePriorities[entry.tasks[index].state];
        const newTerminal = terminalStatePriorities[state];
        if (oldTerminal !== undefined && (newTerminal === undefined || newTerminal < oldTerminal)) return;
        this.setTaskState(entry, index, state, duration);
    }

    /** Upstream `appendMessage`. */
    public appendMessage(testId: string, taskId: string, message: IWireTestMessage): void {
        const entry = this.testById.get(testId);
        const index = this.taskIndex(taskId);
        if (entry === undefined || index === -1) return;
        entry.tasks[index].messages.push({ type: "error", ...message });
        this.changeEmitter.fire({ item: entry, result: this, reason: "message" });
    }

    /** Upstream `appendOutput`: kept in the task; with a test it is also a message of the test. */
    public appendOutput(output: string, taskId: string, location?: IWireTestLocation, testId?: string): void {
        const index = this.taskIndex(taskId);
        if (index === -1) return;
        const task = this.taskList[index];
        const message: ITestOutputMessage = {
            type: "output",
            message: output.length > PREVIEW_LENGTH ? `${output.slice(0, PREVIEW_LENGTH)}…` : output,
            offset: task.output.length,
            length: output.length,
            location,
        };
        task.output += output;
        // Stryker disable next-line ConditionalExpression: equivalent — no test is under an undefined id
        const test = testId === undefined ? undefined : this.testById.get(testId);
        this.outputEmitter.fire({ taskIndex: index, output, testId: test?.item.extId });
        if (test === undefined) {
            task.otherMessages.push(message);
            return;
        }
        test.tasks[index].messages.push(message);
        this.changeEmitter.fire({ item: test, result: this, reason: "message" });
    }

    /** Upstream `markTaskComplete`: the task's queued and running tests become skipped. */
    public markTaskComplete(taskId: string): void {
        const index = this.taskIndex(taskId);
        if (index === -1 || !this.taskList[index].running) return;
        this.taskList[index].running = false;
        for (const test of this.testById.values()) {
            const { state } = test.tasks[index];
            if (state === TestResultState.Queued || state === TestResultState.Running) {
                this.setTaskState(test, index, TestResultState.Skipped);
            }
        }
        this.endTaskEmitter.fire(index);
    }

    /** Upstream `markComplete`: the running tasks complete first. A second call does nothing. */
    public markComplete(): void {
        if (this.completedAtValue !== undefined) return;
        for (const task of this.taskList) this.markTaskComplete(task.id);
        this.completedAtValue = this.now();
        this.completeEmitter.fire();
    }

    private taskIndex(taskId: string): number {
        return this.taskList.findIndex((task) => task.id === taskId);
    }

    private addTestToRun(
        controllerId: string,
        item: IWireTestItem,
        parent: IMutableResultItem | undefined,
    ): IMutableResultItem {
        const node: IMutableResultItem = {
            controllerId,
            item,
            tasks: this.taskList.map(() => ({ state: TestResultState.Unset, messages: [] })),
            ownComputedState: TestResultState.Unset,
            ownDuration: undefined,
            computedState: TestResultState.Unset,
            // Stryker disable next-line ArrayDeclaration: equivalent — a stray entry has no computed state, maxPriority skips it
            children: [],
        };
        this.testById.set(item.extId, node);
        this.counts[TestResultState.Unset]++;
        parent?.children.push(node);
        return node;
    }

    /** Upstream `fireUpdateAndRefresh`. */
    private setTaskState(entry: IMutableResultItem, index: number, state: TestResultState, duration?: number): void {
        const previousOwn = entry.ownComputedState;
        const previousDuration = entry.ownDuration;
        entry.tasks[index].state = state;
        if (duration !== undefined) {
            entry.tasks[index].duration = duration;
            entry.ownDuration = Math.max(entry.ownDuration ?? 0, duration);
        }
        const own = maxPriority(...entry.tasks.map((task) => task.state));
        if (own === previousOwn) {
            if (entry.ownDuration !== previousDuration)
                this.changeEmitter.fire({ item: entry, result: this, reason: "ownState" });
            return;
        }
        entry.ownComputedState = own;
        this.counts[previousOwn]--;
        this.counts[own]++;
        this.changeEmitter.fire({ item: entry, result: this, reason: "ownState" });
        this.refreshComputed(entry);
    }

    /** The test and its ancestors in the run, as far as a computed state changes. */
    private refreshComputed(entry: IMutableResultItem): void {
        for (let node: IMutableResultItem | undefined = entry; node !== undefined; ) {
            const computed = computeState(
                node.ownComputedState,
                node.children.map((child) => child.computedState),
            );
            if (computed === node.computedState) return;
            node.computedState = computed;
            if (node !== entry) this.changeEmitter.fire({ item: node, result: this, reason: "computedState" });
            const parentId = TestId.parentId(node.item.extId);
            // Stryker disable next-line ConditionalExpression: equivalent — no test is under an undefined id
            node = parentId === undefined ? undefined : this.testById.get(parentId);
        }
    }
}
