import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { IExtensionTestingSink } from "../../../../api/common/iExtensionTestingSink.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import {
    parseWireTestController,
    parseWireTestControllerId,
    parseWireTestControllerPatch,
    parseWireTestRunProfile,
    parseWireTestRunProfileId,
    parseWireTestRunProfileUpdate,
    parseWireTestsDiff,
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
        const on = (method: Parameters<typeof rpc.handleNotification>[0], handle: (params: unknown) => void): void => {
            store.add(rpc.handleNotification(method, handle));
        };
        on("testing.registerController", (params) => {
            const controller = parseWireTestController(params);
            // Stryker disable next-line ConditionalExpression: equivalent — without the check the null message throws before the sink changes anything, RpcEndpoint swallows a notification handler's exception
            if (controller === null) return;
            const { controllerId } = controller;
            sink.registerController(controller, {
                expandTest: async (testId, levels) => {
                    await rpc.request("testing.expandTest", { testId, levels });
                },
                refreshTests: async (token) => {
                    await rpc.request("testing.refreshTests", { controllerId }, { token });
                },
            });
        });
        on("testing.updateController", (params) => {
            const patch = parseWireTestControllerPatch(params);
            // Stryker disable next-line ConditionalExpression: equivalent — without the check the null message throws before the sink changes anything, RpcEndpoint swallows a notification handler's exception
            if (patch !== null) sink.updateController(patch);
        });
        on("testing.unregisterController", (params) => {
            const controllerId = parseWireTestControllerId(params);
            // Stryker disable next-line ConditionalExpression: equivalent — without the check the null message throws before the sink changes anything, RpcEndpoint swallows a notification handler's exception
            if (controllerId !== null) sink.unregisterController(controllerId);
        });
        on("testing.publishDiff", (params) => {
            const diff = parseWireTestsDiff(params);
            // Stryker disable next-line ConditionalExpression: equivalent — without the check the null message throws before the sink changes anything, RpcEndpoint swallows a notification handler's exception
            if (diff !== null) sink.publishDiff(diff.diff);
        });
        on("testing.publishProfile", (params) => {
            const profile = parseWireTestRunProfile(params);
            // Stryker disable next-line ConditionalExpression: equivalent — without the check the null message throws before the sink changes anything, RpcEndpoint swallows a notification handler's exception
            if (profile !== null) sink.publishProfile(profile);
        });
        on("testing.updateProfile", (params) => {
            const update = parseWireTestRunProfileUpdate(params);
            // Stryker disable next-line ConditionalExpression: equivalent — without the check the null message throws before the sink changes anything, RpcEndpoint swallows a notification handler's exception
            if (update !== null) sink.updateProfile(update);
        });
        on("testing.removeProfile", (params) => {
            const id = parseWireTestRunProfileId(params);
            // Stryker disable next-line ConditionalExpression: equivalent — without the check the null message throws before the sink changes anything, RpcEndpoint swallows a notification handler's exception
            if (id !== null) sink.removeProfile(id.controllerId, id.profileId);
        });
        store.add({
            dispose: () => {
                sink.reset();
            },
        });
        return store;
    }
}
