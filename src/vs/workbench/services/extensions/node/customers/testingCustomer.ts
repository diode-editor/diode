import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { ISubprocessToHost } from "../../../../api/common/extHostProtocol.ts";
import type { IExtensionTestingSink } from "../../../../api/common/iExtensionTestingSink.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import {
    parseWireAddTestsToRun,
    parseWireExtensionTestRun,
    parseWireTestController,
    parseWireTestControllerId,
    parseWireTestControllerPatch,
    parseWireTestMessagesInRun,
    parseWireTestOutputInRun,
    parseWireTestRunId,
    parseWireTestRunProfile,
    parseWireTestRunProfileId,
    parseWireTestRunProfileUpdate,
    parseWireTestRunTask,
    parseWireTestRunTaskId,
    parseWireTestsDiff,
    parseWireTestStateInRun,
} from "../testingWireParsers.ts";

/**
 * Upstream `MainThreadTesting`. The controllers belong to the spawn: on death they go with their trees and
 * profiles, and a revived extension creates them again on activation.
 */
export class TestingCustomer implements IExtensionHostCustomer {
    public constructor(private readonly sink: IExtensionTestingSink | undefined) {}

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const store = new DisposableStore();
        const sink = this.sink;
        if (sink === undefined) return store;
        /** A malformed message (`null`) is dropped. */
        const on = <T,>(
            method: keyof ISubprocessToHost["notifications"],
            parse: (params: unknown) => T | null,
            deliver: (message: T) => void,
        ): void => {
            store.add(
                rpc.handleNotification(method, (params) => {
                    const message = parse(params);
                    // Stryker disable next-line ConditionalExpression: equivalent — without the check the null message throws in the sink before it changes anything, RpcEndpoint swallows a notification handler's exception
                    if (message !== null) deliver(message);
                }),
            );
        };
        // One function for every controller of this subprocess: the core cancels a run once per subprocess.
        const cancelTestRun = (runId: string, taskId?: string): void => {
            rpc.notify("testing.cancelExtensionTestRun", { runId, taskId });
        };
        on("testing.registerController", parseWireTestController, (controller) => {
            const { controllerId } = controller;
            sink.registerController(controller, {
                expandTest: async (testId, levels) => {
                    await rpc.request("testing.expandTest", { testId, levels });
                },
                refreshTests: async (token) => {
                    await rpc.request("testing.refreshTests", { controllerId }, { token });
                },
                runTests: (requests, token) => rpc.request("testing.runControllerTests", { requests }, { token }),
                cancelTestRun,
            });
        });
        on("testing.updateController", parseWireTestControllerPatch, (patch) => {
            sink.updateController(patch);
        });
        on("testing.unregisterController", parseWireTestControllerId, (controllerId) => {
            sink.unregisterController(controllerId);
        });
        on("testing.publishDiff", parseWireTestsDiff, ({ diff }) => {
            sink.publishDiff(diff);
        });
        on("testing.publishProfile", parseWireTestRunProfile, (profile) => {
            sink.publishProfile(profile);
        });
        on("testing.updateProfile", parseWireTestRunProfileUpdate, (update) => {
            sink.updateProfile(update);
        });
        on("testing.removeProfile", parseWireTestRunProfileId, ({ controllerId, profileId }) => {
            sink.removeProfile(controllerId, profileId);
        });
        on("testing.startedExtensionTestRun", parseWireExtensionTestRun, (run) => {
            sink.startedExtensionTestRun(run);
        });
        on("testing.finishedExtensionTestRun", parseWireTestRunId, (runId) => {
            sink.finishedExtensionTestRun(runId);
        });
        on("testing.startedTestRunTask", parseWireTestRunTask, (task) => {
            sink.startedTestRunTask(task);
        });
        on("testing.finishedTestRunTask", parseWireTestRunTaskId, (task) => {
            sink.finishedTestRunTask(task);
        });
        on("testing.addTestsToRun", parseWireAddTestsToRun, (add) => {
            sink.addTestsToRun(add);
        });
        on("testing.updateTestStateInRun", parseWireTestStateInRun, (update) => {
            sink.updateTestStateInRun(update);
        });
        on("testing.appendTestMessagesInRun", parseWireTestMessagesInRun, (messages) => {
            sink.appendTestMessagesInRun(messages);
        });
        on("testing.appendOutputToRun", parseWireTestOutputInRun, (output) => {
            sink.appendOutputToRun(output);
        });
        store.add({
            dispose: () => {
                sink.reset();
            },
        });
        return store;
    }
}
