import { Emitter, type Event } from "../../../../base/common/event.ts";
import { Disposable, DisposableStore } from "../../../../base/common/lifecycle.ts";
import { generateUuid } from "../../../../base/common/uuid.ts";
import {
    type ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IWireExtensionTestRun,
    TestResultState,
    TestRunProfileBitset,
} from "../../../api/common/testingWireTypes.ts";

import {
    type IResolvedTestRunRequest,
    type ITestResultItem,
    type ITestResultItemChange,
    LiveTestResult,
} from "./testResult.ts";

/** Upstream `RETAIN_MAX_RESULTS` (`testResultStorage.ts`). */
export const RETAIN_MAX_RESULTS = 128;

/** Upstream `ResultChangeEvent`. */
export type ResultChangeEvent =
    | { readonly started: LiveTestResult }
    | { readonly completed: LiveTestResult }
    | { readonly removed: readonly LiveTestResult[] };

// Stryker disable next-line StringLiteral: token() returns a unique Token matched by reference; the string is a label
export const TestResultServiceDIToken = token<TestResultService>("TestResultService");

/**
 * Upstream `TestResultService`: the runs, the live ones first, then the completed ones by completion, the latest
 * first; `testing.isRunning` and `testing.hasAnyResults`. Deviation: the results live in memory only (upstream keeps
 * them in the workspace storage) — a restart starts with none.
 */
export class TestResultService extends Disposable {
    public static dependencies = [ContextKeyServiceDIToken] as const;

    private resultList: LiveTestResult[] = [];
    private readonly resultStores = new Map<LiveTestResult, DisposableStore>();
    private insertOrderCounter = 0;
    private readonly changeResultEmitter = this.register(new Emitter<ResultChangeEvent>());
    private readonly testChangeEmitter = this.register(new Emitter<ITestResultItemChange>());
    public readonly onResultsChanged: Event<ResultChangeEvent> = this.changeResultEmitter.event;
    public readonly onTestChanged: Event<ITestResultItemChange> = this.testChangeEmitter.event;

    public constructor(
        private readonly contextKeys: ContextKeyService,
        /** The clock of the runs and of the summary's ticking time. */
        public readonly now: () => number = Date.now,
    ) {
        super();
        contextKeys.set("testing.isRunning", false);
        contextKeys.set("testing.hasAnyResults", false);
        this.register({
            dispose: () => {
                for (const store of this.resultStores.values()) store.dispose();
            },
        });
    }

    public get results(): readonly LiveTestResult[] {
        return this.resultList;
    }

    /** Upstream `getStateById`: the test's state in the latest run where it has one. */
    public getStateById(testId: string): [LiveTestResult, ITestResultItem] | undefined {
        for (const result of this.resultList) {
            const item = result.getStateById(testId);
            if (item !== undefined && item.computedState !== TestResultState.Unset) return [result, item];
        }
        return undefined;
    }

    public getResult(id: string): LiveTestResult | undefined {
        return this.resultList.find((result) => result.id === id);
    }

    /** Upstream `createLiveResult` for a run the core starts. */
    public createLiveResult(request: IResolvedTestRunRequest): LiveTestResult {
        return this.push(new LiveTestResult(generateUuid(), true, request, this.insertOrderCounter++, this.now));
    }

    /** Upstream `createLiveResult` for a run the extension started; `profileGroup` of its profile, if any. */
    public createExtensionLiveResult(
        run: IWireExtensionTestRun,
        profileGroup: IResolvedTestRunRequest["group"] | undefined,
    ): LiveTestResult {
        const request: IResolvedTestRunRequest = {
            preserveFocus: run.preserveFocus,
            targets:
                profileGroup === undefined || run.profileId === null
                    ? []
                    : [{ profileId: run.profileId, controllerId: run.controllerId, testIds: run.include }],
            exclude: run.exclude,
            continuous: run.continuous,
            group: profileGroup ?? TestRunProfileBitset.Run,
        };
        return this.push(new LiveTestResult(run.runId, run.persist, request, this.insertOrderCounter++, this.now));
    }

    /** Upstream `clear`: the completed results go, the live ones stay. */
    public clear(): void {
        const removed = this.resultList.filter((result) => result.completedAt !== undefined);
        this.resultList = this.resultList.filter((result) => result.completedAt === undefined);
        for (const result of removed) this.dropStore(result);
        this.contextKeys.set("testing.hasAnyResults", this.resultList.length > 0);
        this.changeResultEmitter.fire({ removed });
    }

    private push(result: LiveTestResult): LiveTestResult {
        this.resultList.unshift(result);
        this.contextKeys.set("testing.hasAnyResults", true);
        if (this.resultList.length > RETAIN_MAX_RESULTS) {
            const dropped = this.resultList.pop();
            if (dropped !== undefined) this.dropStore(dropped);
        }
        const store = new DisposableStore();
        this.resultStores.set(result, store);
        store.add(result);
        store.add(
            result.onComplete(() => {
                this.onComplete(result);
            }),
        );
        store.add(
            result.onChange((change) => {
                this.testChangeEmitter.fire(change);
            }),
        );
        this.contextKeys.set("testing.isRunning", true);
        this.changeResultEmitter.fire({ started: result });
        return result;
    }

    private dropStore(result: LiveTestResult): void {
        this.resultStores.get(result)?.dispose();
        this.resultStores.delete(result);
    }

    /** Upstream `resort`: the live ones first, then by insertion, the latest first. */
    private onComplete(result: LiveTestResult): void {
        this.resultList.sort((a, b) => {
            if ((a.completedAt === undefined) !== (b.completedAt === undefined))
                return a.completedAt === undefined ? -1 : 1;
            return b.insertOrder - a.insertOrder;
        });
        this.contextKeys.set(
            "testing.isRunning",
            this.resultList.some((other) => other.completedAt === undefined),
        );
        this.changeResultEmitter.fire({ completed: result });
    }
}
