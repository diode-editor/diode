import { CancellationTokenSource, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import { Emitter, type Event } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import {
    type ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IWireRunControllerTestsResult,
    type IWireStartControllerTests,
    type IWireTestItem,
    type IWireTestItemUpdate,
    TestDiffOpType,
    TestId,
    type TestItemExpandState,
    TestRunProfileBitset,
    type TestRunProfileGroup,
    type WireTestsDiffOp,
} from "../../../api/common/testingWireTypes.ts";

import { type TestProfileService, TestProfileServiceDIToken } from "./testProfileService.ts";
import type { IResolvedTestRunRequest, LiveTestResult } from "./testResult.ts";
import { type TestResultService, TestResultServiceDIToken } from "./testResultService.ts";

/** Upstream `IMainThreadTestController`: a controller as the core sees it. */
export interface ITestController {
    readonly id: string;
    readonly label: string;
    /** Has a `refreshHandler`: upstream's `TestControllerCapability.Refresh`. */
    readonly canRefresh: boolean;
    expandTest(testId: string, levels: number): Promise<void>;
    refreshTests(token: ICancellationToken): Promise<void>;
    /** Resolves when the `runHandler`s have settled and their runs have ended; rejects if the extension is gone. */
    runTests(
        requests: readonly IWireStartControllerTests[],
        token: ICancellationToken,
    ): Promise<IWireRunControllerTestsResult[]>;
    /** The same function for the controllers of one extension host: a run is cancelled there once. */
    readonly cancelTestRun: (runId: string, taskId?: string) => void;
}

/** Upstream `$updateController`: only the fields that changed. */
export interface ITestControllerPatch {
    readonly label?: string;
    readonly canRefresh?: boolean;
}

/** Disposing it drops the controller's tests. */
export interface ITestControllerRegistration extends IDisposable {
    update(patch: ITestControllerPatch): void;
}

type MutableTestController = { -readonly [K in keyof ITestController]: ITestController[K] };

/** Upstream `IncrementalTestCollectionItem`: a test with the ids of its children. */
export interface ITestNode {
    readonly controllerId: string;
    readonly expand: TestItemExpandState;
    readonly item: IWireTestItem;
    readonly children: ReadonlySet<string>;
}

interface IMutableTestNode {
    readonly controllerId: string;
    expand: TestItemExpandState;
    item: IWireTestItem;
    readonly children: Set<string>;
}

/** What a run started from the UI needs from the workbench: upstream's `saveAllBeforeTest` and the error toast. */
export interface ITestRunUi {
    /** Upstream `saveAllBeforeTest`: Save All while `testing.saveBeforeTest` is on. */
    saveAllBeforeTest(): Promise<void>;
    /** Upstream `notificationService.error`. */
    showError(message: string): void;
}

// Stryker disable next-line StringLiteral: token() returns a unique Token matched by reference; the string is a label
export const TestRunUiDIToken = token<ITestRunUi>("TestRunUi");

/** Upstream `AmbiguousRunTestsRequest`: tests to run with the default profile of their controller. */
export interface IRunTestsRequest {
    readonly tests: readonly ITestNode[];
    readonly exclude?: readonly ITestNode[];
    readonly group?: TestRunProfileGroup;
}

// Stryker disable next-line StringLiteral: token() returns a unique Token matched by reference; the string is a label
export const TestServiceDIToken = token<TestService>("TestService");

/**
 * Upstream `TestService` with its `MainThreadTestCollection`: the controllers extensions registered, their test
 * trees mirrored from the diffs, the `testing.providerCount`/`canRefresh`/`isRefreshing` keys, and the runs.
 */
export class TestService extends Disposable {
    public static dependencies = [
        ContextKeyServiceDIToken,
        TestResultServiceDIToken,
        TestProfileServiceDIToken,
        TestRunUiDIToken,
    ] as const;

    private readonly controllers = new Map<string, MutableTestController>();
    private readonly items = new Map<string, IMutableTestNode>();
    private readonly roots = new Map<string, IMutableTestNode>();
    private readonly refreshCancellations = new Set<CancellationTokenSource>();
    /** Upstream `uiRunningTests`: the token of each run the core started, by result id. */
    private readonly uiRunningTests = new Map<string, CancellationTokenSource>();
    private readonly onDidProcessDiffEmitter = this.register(new Emitter<readonly WireTestsDiffOp[]>());
    /** After a diff has been applied to the tree. */
    public readonly onDidProcessDiff: Event<readonly WireTestsDiffOp[]> = this.onDidProcessDiffEmitter.event;

    public constructor(
        private readonly contextKeys: ContextKeyService,
        private readonly results: TestResultService,
        private readonly profiles: TestProfileService,
        private readonly ui: ITestRunUi,
    ) {
        super();
        this.updateControllerKeys();
        contextKeys.set("testing.isRefreshing", false);
    }

    /** The controllers' root tests, in registration order. */
    public get rootItems(): ITestNode[] {
        return [...this.roots.values()];
    }

    public getNodeById(testId: string): ITestNode | undefined {
        return this.items.get(testId);
    }

    public getTestController(controllerId: string): ITestController | undefined {
        return this.controllers.get(controllerId);
    }

    public registerTestController(controller: ITestController): ITestControllerRegistration {
        const registered: MutableTestController = { ...controller };
        this.controllers.set(controller.id, registered);
        this.updateControllerKeys();
        return {
            update: ({ label, canRefresh }) => {
                registered.label = label ?? registered.label;
                registered.canRefresh = canRefresh ?? registered.canRefresh;
                this.updateControllerKeys();
            },
            dispose: () => {
                if (this.controllers.get(controller.id) !== registered) return;
                const diff: WireTestsDiffOp[] = [];
                for (const [rootId, root] of this.roots) {
                    if (root.controllerId === controller.id) diff.push({ op: TestDiffOpType.Remove, itemId: rootId });
                }
                this.publishDiff(diff);
                this.controllers.delete(controller.id);
                this.updateControllerKeys();
            },
        };
    }

    /** Upstream `AbstractIncrementalTestCollection.apply`. */
    public publishDiff(diff: readonly WireTestsDiffOp[]): void {
        for (const op of diff) {
            switch (op.op) {
                case TestDiffOpType.Add:
                    this.add(op.item.item, op.item.expand);
                    break;
                case TestDiffOpType.Update:
                    this.update(op.item);
                    break;
                case TestDiffOpType.Remove:
                    this.remove(op.itemId);
                    break;
            }
        }
        this.onDidProcessDiffEmitter.fire(diff);
    }

    /** Asks the controller to resolve the test's children, `levels` deep (`Infinity` — all). */
    public async expandTest(testId: string, levels: number): Promise<void> {
        await this.controllers.get(TestId.root(testId))?.expandTest(testId, Number.isFinite(levels) ? levels : -1);
    }

    /** Every controller, or the given one; `testing.isRefreshing` holds until all have finished. */
    public async refreshTests(controllerId?: string): Promise<void> {
        const cts = new CancellationTokenSource();
        this.refreshCancellations.add(cts);
        this.contextKeys.set("testing.isRefreshing", true);
        try {
            const targets = [...this.controllers.values()].filter(
                (controller) => controllerId === undefined || controller.id === controllerId,
            );
            await Promise.all(targets.map((controller) => controller.refreshTests(cts.token)));
        } finally {
            this.refreshCancellations.delete(cts);
            this.contextKeys.set("testing.isRefreshing", this.refreshCancellations.size > 0);
            // Stryker disable next-line CallExpression: hygiene — the source's listener list goes with it; nothing reads a finished refresh's token
            cts.dispose();
        }
    }

    public cancelRefreshTests(): void {
        // Each refresh drops its own source when it settles.
        for (const cts of this.refreshCancellations) cts.cancel();
        this.contextKeys.set("testing.isRefreshing", false);
    }

    /**
     * Upstream `runTests`: each test with the first profile of the group its controller has for it (defaults
     * first); a test without one is not run.
     */
    public runTests(req: IRunTestsRequest): Promise<LiveTestResult> {
        const group = req.group ?? TestRunProfileBitset.Run;
        const targets: { controllerId: string; profileId: number; testIds: string[] }[] = [];
        for (const test of req.tests) {
            const profile = this.profiles.getDefaultProfileForTest(group, test);
            if (profile === undefined) continue;
            const { controllerId, profileId } = profile;
            const existing = targets.find((t) => t.controllerId === controllerId && t.profileId === profileId);
            if (existing === undefined) targets.push({ controllerId, profileId, testIds: [test.item.extId] });
            else existing.testIds.push(test.item.extId);
        }
        return this.runResolvedTests({
            targets,
            group,
            exclude: req.exclude?.map((test) => test.item.extId),
        });
    }

    /**
     * Upstream `runResolvedTests`: the result is live at once; Save All, then each controller's share. A `runHandler`'s
     * error is a toast; a controller whose extension died meanwhile just ends its share.
     */
    public async runResolvedTests(req: IResolvedTestRunRequest): Promise<LiveTestResult> {
        const exclude = req.exclude ?? [];
        const result = this.results.createLiveResult({ ...req, exclude });
        const cts = new CancellationTokenSource();
        this.uiRunningTests.set(result.id, cts);
        try {
            await this.ui.saveAllBeforeTest();
            const controllerIds = [...new Set(req.targets.map((target) => target.controllerId))];
            await Promise.all(
                controllerIds.map(async (controllerId) => {
                    const controller = this.controllers.get(controllerId);
                    if (controller === undefined) return;
                    const requests = req.targets
                        .filter((target) => target.controllerId === controllerId)
                        .map((target) => ({
                            runId: result.id,
                            controllerId,
                            profileId: target.profileId,
                            testIds: target.testIds,
                            excludeExtIds: exclude.filter((testId) => !target.testIds.includes(testId)),
                        }));
                    let answers: IWireRunControllerTestsResult[];
                    try {
                        answers = await controller.runTests(requests, cts.token);
                    } catch {
                        return;
                    }
                    const errors = answers.flatMap((answer) => answer.error ?? []);
                    if (errors.length > 0) {
                        this.ui.showError(`An error occurred attempting to run tests: ${errors.join(" ")}`);
                    }
                }),
            );
            return result;
        } finally {
            this.uiRunningTests.delete(result.id);
            // Stryker disable next-line CallExpression: hygiene — the source's listener list goes with it; nothing reads a finished run's token
            cts.dispose();
            result.markComplete();
        }
    }

    /**
     * Upstream `cancelTestRun`: the extension hosts cancel the run (or its task), a run the core started has its token
     * cancelled too. Without `runId` — every live run.
     */
    public cancelTestRun(runId?: string, taskId?: string): void {
        if (runId === undefined) {
            for (const result of this.results.results) {
                if (result.completedAt === undefined) this.cancelTestRun(result.id);
            }
            return;
        }
        const cancels = new Set([...this.controllers.values()].map((controller) => controller.cancelTestRun));
        for (const cancel of cancels) cancel(runId, taskId);
        if (taskId === undefined) this.uiRunningTests.get(runId)?.cancel();
    }

    private updateControllerKeys(): void {
        const controllers = [...this.controllers.values()];
        this.contextKeys.set("testing.providerCount", controllers.length);
        this.contextKeys.set(
            "testing.canRefresh",
            controllers.some((controller) => controller.canRefresh),
        );
    }

    /** A test whose parent is unknown is dropped, as upstream. */
    private add(item: IWireTestItem, expand: TestItemExpandState): void {
        const node: IMutableTestNode = { controllerId: TestId.root(item.extId), expand, item, children: new Set() };
        const parentId = TestId.parentId(item.extId);
        if (parentId === undefined) {
            this.roots.set(item.extId, node);
        } else {
            const parent = this.items.get(parentId);
            if (parent === undefined) return;
            parent.children.add(item.extId);
        }
        this.items.set(item.extId, node);
    }

    private update(patch: IWireTestItemUpdate): void {
        const existing = this.items.get(patch.extId);
        if (existing === undefined) return;
        if (patch.expand !== undefined) existing.expand = patch.expand;
        if (patch.item !== undefined) existing.item = { ...existing.item, ...patch.item };
    }

    private remove(testId: string): void {
        const parentId = TestId.parentId(testId);
        if (parentId === undefined) this.roots.delete(testId);
        else this.items.get(parentId)?.children.delete(testId);
        this.removeSubtree(testId);
    }

    /** Walks the subtree through the children, an unknown id is nothing. */
    private removeSubtree(testId: string): void {
        const node = this.items.get(testId);
        if (node === undefined) return;
        this.items.delete(testId);
        for (const child of node.children) this.removeSubtree(child);
    }
}
