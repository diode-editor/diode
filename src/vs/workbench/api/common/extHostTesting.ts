import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { namespaceTestTag, TestItemImpl, TestItemRootImpl } from "./extHostTestItem.ts";
import { ExtHostTestItemCollection } from "./extHostTestItemCollection.ts";
import { TestRunProfileKind } from "./testingTypes.ts";
import {
    type IWireTestRunProfileUpdate,
    TestId,
    TestRunProfileBitset,
    type TestRunProfileGroup,
} from "./testingWireTypes.ts";
import { toVscodeCancellationToken } from "./vscodeCancellation.ts";
import { CancellationTokenSource, EventEmitter } from "./vscodeTypes.ts";

// Upstream `ExtHostTesting` (`api/common/extHostTesting.ts`): the controllers live here, the host mirrors their
// trees (`testing.publishDiff`) and profiles, and asks back to expand (`testing.expandTest`) and to refresh
// (`testing.refreshTests`). Runs are not wired yet: nobody calls `runHandler`, `createTestRun` is inert.

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
}

/** Upstream's `hash(label)`: the same profile tends to keep its id across reloads. */
function labelHash(label: string): number {
    let hash = 0;
    for (let i = 0; i < label.length; i++) hash = (Math.imul(hash, 31) + label.charCodeAt(i)) | 0;
    return hash;
}

function createInertTestRun(name: string | undefined, persist: boolean): vscode.TestRun {
    const onDidDispose = new EventEmitter<void>();
    return {
        name,
        token: new CancellationTokenSource().token,
        isPersisted: persist,
        enqueued: (): void => undefined,
        started: (): void => undefined,
        skipped: (): void => undefined,
        failed: (): void => undefined,
        errored: (): void => undefined,
        passed: (): void => undefined,
        appendOutput: (): void => undefined,
        addCoverage: (): void => undefined,
        end: (): void => {
            onDidDispose.fire();
            onDidDispose.dispose();
        },
        onDidDispose: onDidDispose.event,
    };
}

/** Upstream `TestRunProfileImpl`; `isDefault` is the extension's own, the host has no default picker yet. */
class TestRunProfileImpl implements vscode.TestRunProfile {
    public readonly onDidChangeDefault = new EventEmitter<boolean>().event;
    private disposed = false;

    public constructor(
        private readonly publish: (update: IWireTestRunProfileUpdate["update"]) => void,
        private readonly remove: () => void,
        private readonly controllerId: string,
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

export function createExtHostTesting(rpc: SubprocessRpc): typeof vscode.tests {
    const controllers = new Map<string, IControllerInfo>();

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
        const cancel = toVscodeCancellationToken(token);
        try {
            await handler(cancel.token);
        } finally {
            cancel.dispose();
        }
        return null;
    });

    function createTestController(controllerId: string, label: string): vscode.TestController {
        if (controllers.has(controllerId)) {
            throw new Error(`Attempt to insert a duplicate controller with ID "${controllerId}"`);
        }
        let controllerLabel = label;
        let refresh: ((token: vscode.CancellationToken) => Thenable<void> | void) | undefined;
        const profileIds = new Set<number>();
        // Registered before the collection's first diff, which carries the root.
        rpc.notify("testing.registerController", { controllerId, label, canRefresh: false });
        const collection = new ExtHostTestItemCollection({
            controllerId,
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
                return controllerLabel;
            },
            set label(value: string) {
                controllerLabel = value;
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
                while (profileIds.has(profileId)) profileId++;
                profileIds.add(profileId);
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
                return new TestRunProfileImpl(
                    (update) => {
                        rpc.notify("testing.updateProfile", { controllerId, profileId, update });
                    },
                    () => {
                        profileIds.delete(profileId);
                        rpc.notify("testing.removeProfile", { controllerId, profileId });
                    },
                    controllerId,
                    kind,
                    profileLabel,
                    runHandler,
                    isDefault,
                    tag,
                    supportsContinuousRun,
                );
            },
            createTestItem: (id, itemLabel, uri) => new TestItemImpl(controllerId, id, itemLabel, uri),
            createTestRun: (_request, name, persist = true) => createInertTestRun(name, persist),
            invalidateTestResults: (): void => undefined,
            dispose: () => {
                if (controllers.get(controllerId)?.controller !== controller) return;
                controllers.delete(controllerId);
                collection.dispose();
                rpc.notify("testing.unregisterController", { controllerId });
            },
        };
        controllers.set(controllerId, { controller, collection });
        return controller;
    }

    return { createTestController };
}
