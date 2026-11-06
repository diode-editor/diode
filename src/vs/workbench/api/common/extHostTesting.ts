import type * as vscode from "vscode";

import type { ICancellationToken } from "../../../base/common/cancellation.ts";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { TestItemImpl, TestItemRootImpl } from "./extHostTestItem.ts";
import { ExtHostTestItemCollection } from "./extHostTestItemCollection.ts";
import { TestRunCoordinator, type TestRunTracker } from "./extHostTestRun.ts";
import { TestRunProfileKind, TestRunRequest } from "./testingTypes.ts";
import {
    type IWireCancelTestRun,
    type IWireRunControllerTests,
    type IWireRunControllerTestsResult,
    type IWireStartControllerTests,
    type IWireTestItemArg,
    type IWireTestRunProfileUpdate,
    namespaceTestTag,
    TEST_ID_DELIMITER,
    TestId,
    TestRunProfileBitset,
    type TestRunProfileGroup,
} from "./testingWireTypes.ts";
import { callWithVscodeToken, toVscodeCancellationToken } from "./vscodeCancellation.ts";
import { EventEmitter } from "./vscodeTypes.ts";

// Upstream `ExtHostTesting` (`api/common/extHostTesting.ts`): the controllers live here, the host mirrors their
// trees (`testing.publishDiff`) and profiles, and asks back to expand (`testing.expandTest`), to refresh
// (`testing.refreshTests`) and to run (`testing.runControllerTests`, the profile's `runHandler`); a run's reports go
// through `TestRunCoordinator`.

const OUTPUT_CHANNEL = "extensions";
const OUTPUT_LABEL = "Extensions";

const PROFILE_GROUPS: Readonly<Record<vscode.TestRunProfileKind, TestRunProfileGroup>> = {
    [TestRunProfileKind.Run]: TestRunProfileBitset.Run,
    [TestRunProfileKind.Debug]: TestRunProfileBitset.Debug,
    [TestRunProfileKind.Coverage]: TestRunProfileBitset.Coverage,
};

interface IControllerInfo {
    readonly controller: vscode.TestController;
    readonly collection: ExtHostTestItemCollection;
    readonly profiles: ReadonlyMap<number, TestRunProfileImpl>;
}

/** Upstream's `hash(label)`: the same profile tends to keep its id across reloads. */
function labelHash(label: string): number {
    let hash = 0;
    for (let i = 0; i < label.length; i++) hash = (Math.imul(hash, 31) + label.charCodeAt(i)) | 0;
    return hash;
}

/** Upstream `TestRunProfileImpl`; `isDefault` is the extension's own, the host has no default picker yet. */
class TestRunProfileImpl implements vscode.TestRunProfile {
    public readonly onDidChangeDefault = new EventEmitter<boolean>().event;
    private disposed = false;

    public constructor(
        private readonly publish: (update: IWireTestRunProfileUpdate["update"]) => void,
        private readonly remove: () => void,
        private readonly controllerId: string,
        public readonly profileId: number,
        public readonly kind: vscode.TestRunProfileKind,
        private labelValue: string,
        public runHandler: (request: vscode.TestRunRequest, token: vscode.CancellationToken) => Thenable<void> | void,
        private isDefaultValue: boolean,
        private tagValue: vscode.TestTag | undefined,
        private supportsContinuousRunValue: boolean,
    ) {}

    public configureHandler: (() => void) | undefined = undefined;

    public get label(): string {
        return this.labelValue;
    }

    public set label(label: string) {
        if (label === this.labelValue) return;
        this.labelValue = label;
        this.update({ label });
    }

    public get isDefault(): boolean {
        return this.isDefaultValue;
    }

    public set isDefault(isDefault: boolean) {
        if (isDefault === this.isDefaultValue) return;
        this.isDefaultValue = isDefault;
        this.update({ isDefault });
    }

    public get tag(): vscode.TestTag | undefined {
        return this.tagValue;
    }

    public set tag(tag: vscode.TestTag | undefined) {
        if (tag?.id === this.tagValue?.id) return;
        this.tagValue = tag;
        this.update({ tag: tag === undefined ? null : namespaceTestTag(this.controllerId, tag.id) });
    }

    public get supportsContinuousRun(): boolean {
        return this.supportsContinuousRunValue;
    }

    public set supportsContinuousRun(supports: boolean) {
        if (supports === this.supportsContinuousRunValue) return;
        this.supportsContinuousRunValue = supports;
        this.update({ supportsContinuousRun: supports });
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.remove();
    }

    private update(update: IWireTestRunProfileUpdate["update"]): void {
        if (!this.disposed) this.publish(update);
    }
}

export interface IExtHostTesting {
    readonly tests: typeof vscode.tests;
    /**
     * Upstream's argument processor for `MarshalledId.TestItemContext`: a Test Explorer row ({@link IWireTestItemArg})
     * becomes the extension's own `TestItem`, `undefined` once the test is gone.
     */
    processArgument(arg: unknown): unknown;
}

export function createExtHostTesting(rpc: SubprocessRpc): IExtHostTesting {
    const controllers = new Map<string, IControllerInfo>();
    const runTracker = new TestRunCoordinator(rpc);

    /** Upstream `runControllerTestRequest`. */
    async function runControllerTestRequest(
        req: IWireStartControllerTests,
        token: ICancellationToken,
    ): Promise<IWireRunControllerTestsResult> {
        const lookup = controllers.get(req.controllerId);
        const profile = lookup?.profiles.get(req.profileId);
        if (lookup === undefined || profile === undefined) return {};
        const { collection, controller } = lookup;
        const include = req.testIds.flatMap((testId) => collection.tree.get(testId) ?? []);
        if (include.length === 0) return {};
        // Only the exclusions under an included test matter.
        const exclude = req.excludeExtIds
            .flatMap((testId) => collection.tree.get(testId) ?? [])
            .filter((test) => include.some((inc) => test.fullId.startsWith(inc.fullId + TEST_ID_DELIMITER)));
        const request = new TestRunRequest(
            include.some((test) => test.actual instanceof TestItemRootImpl) ? undefined : include.map((t) => t.actual),
            exclude.map((test) => test.actual),
            profile,
            false,
        );
        const tracker: TestRunTracker = runTracker.prepareForMainThreadTestRun(
            request,
            req.runId,
            { controllerId: req.controllerId, root: collection.root, defaultTaskName: controller.label },
            token,
        );
        // The handler's token lives as long as the request: its runs go on after it has returned.
        const handlerToken = toVscodeCancellationToken(token);
        try {
            await profile.runHandler(request, handlerToken.token);
            return {};
        } catch (error) {
            return { error: String(error) };
        } finally {
            if (tracker.hasRunningTasks && !token.isCancellationRequested) {
                await new Promise<void>((resolve) => {
                    tracker.onEnd(() => {
                        resolve();
                    });
                });
            }
            runTracker.disposeTestRun(tracker);
            handlerToken.dispose();
        }
    }

    rpc.handleRequest("testing.runControllerTests", (params, token) => {
        const { requests } = params as IWireRunControllerTests;
        return Promise.all(requests.map((req) => runControllerTestRequest(req, token)));
    });
    rpc.handleNotification("testing.cancelExtensionTestRun", (params) => {
        const { runId, taskId } = params as IWireCancelTestRun;
        if (runId === undefined) runTracker.cancelAllRuns();
        else runTracker.cancelRunById(runId, taskId);
    });

    rpc.handleRequest("testing.expandTest", async (params) => {
        const { testId, levels } = params as { testId: string; levels: number };
        const collection = controllers.get(TestId.root(testId))?.collection;
        if (collection === undefined) return null;
        await collection.expand(testId, levels < 0 ? Infinity : levels);
        collection.flushDiff();
        return null;
    });
    rpc.handleRequest("testing.refreshTests", async (params, token) => {
        const { controllerId } = params as { controllerId: string };
        const handler = controllers.get(controllerId)?.controller.refreshHandler;
        if (handler === undefined) return null;
        await callWithVscodeToken(token, (t) => handler(t));
        return null;
    });

    function createTestController(controllerId: string, label: string): vscode.TestController {
        if (controllers.has(controllerId)) {
            throw new Error(`Attempt to insert a duplicate controller with ID "${controllerId}"`);
        }
        let refresh: ((token: vscode.CancellationToken) => Thenable<void> | void) | undefined;
        const profiles = new Map<number, TestRunProfileImpl>();
        // Registered before the collection's first diff, which carries the root.
        rpc.notify("testing.registerController", { controllerId, label, canRefresh: false });
        const collection = new ExtHostTestItemCollection({
            root: new TestItemRootImpl(controllerId, label),
            publishDiff: (diff) => {
                rpc.notify("testing.publishDiff", { controllerId, diff });
            },
            logError: (message) => {
                rpc.notify("output.append", {
                    channel: OUTPUT_CHANNEL,
                    label: OUTPUT_LABEL,
                    level: "error",
                    value: message,
                });
            },
        });

        const controller: vscode.TestController = {
            get id() {
                return controllerId;
            },
            get label() {
                return collection.root.label;
            },
            set label(value: string) {
                collection.root.label = value;
                rpc.notify("testing.updateController", { controllerId, label: value });
            },
            items: collection.root.children,
            get refreshHandler() {
                return refresh;
            },
            set refreshHandler(value) {
                refresh = value;
                rpc.notify("testing.updateController", { controllerId, canRefresh: value !== undefined });
            },
            get resolveHandler() {
                return collection.resolveHandler as
                    | ((item: vscode.TestItem | undefined) => Thenable<void> | void)
                    | undefined;
            },
            set resolveHandler(handler) {
                collection.resolveHandler = handler as
                    | ((item: TestItemImpl | undefined) => Thenable<void> | void)
                    | undefined;
            },
            createRunProfile: (
                profileLabel,
                kind,
                runHandler,
                isDefault = false,
                tag,
                supportsContinuousRun = false,
            ) => {
                let profileId = labelHash(profileLabel);
                while (profiles.has(profileId)) profileId++;
                rpc.notify("testing.publishProfile", {
                    controllerId,
                    profileId,
                    label: profileLabel,
                    group: PROFILE_GROUPS[kind],
                    isDefault,
                    tag: tag === undefined ? null : namespaceTestTag(controllerId, tag.id),
                    hasConfigurationHandler: false,
                    supportsContinuousRun,
                });
                const profile = new TestRunProfileImpl(
                    (update) => {
                        rpc.notify("testing.updateProfile", { controllerId, profileId, update });
                    },
                    () => {
                        profiles.delete(profileId);
                        rpc.notify("testing.removeProfile", { controllerId, profileId });
                    },
                    controllerId,
                    profileId,
                    kind,
                    profileLabel,
                    runHandler,
                    isDefault,
                    tag,
                    supportsContinuousRun,
                );
                profiles.set(profileId, profile);
                return profile;
            },
            createTestItem: (id, itemLabel, uri) => new TestItemImpl(controllerId, id, itemLabel, uri),
            createTestRun: (request, name, persist = true) => {
                const { profile } = request;
                if (profile !== undefined && !(profile instanceof TestRunProfileImpl)) {
                    throw new Error(
                        "TestRunRequest.profile is not an instance created from TestController.createRunProfile",
                    );
                }
                return runTracker.createTestRun(
                    { controllerId, root: collection.root, defaultTaskName: collection.root.label },
                    request,
                    profile?.profileId ?? null,
                    name,
                    persist,
                );
            },
            invalidateTestResults: (): void => undefined,
            dispose: () => {
                if (controllers.get(controllerId)?.controller !== controller) return;
                controllers.delete(controllerId);
                collection.dispose();
                rpc.notify("testing.unregisterController", { controllerId });
            },
        };
        controllers.set(controllerId, { controller, collection, profiles });
        return controller;
    }

    return {
        tests: { createTestController },
        processArgument: (arg) => {
            if (!isTestItemArg(arg)) return arg;
            return controllers.get(TestId.root(arg.$testId))?.collection.tree.get(arg.$testId)?.actual;
        },
    };
}

function isTestItemArg(arg: unknown): arg is IWireTestItemArg {
    return typeof (arg as Partial<Record<keyof IWireTestItemArg, unknown>> | null | undefined)?.$testId === "string";
}
