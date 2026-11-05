import type { ICancellationToken } from "../../../base/common/cancellation.ts";

import type {
    IWireTestController,
    IWireTestControllerPatch,
    IWireTestRunProfile,
    IWireTestRunProfileUpdate,
    WireTestsDiffOp,
} from "./testingWireTypes.ts";

/** One controller in the subprocess: upstream `IMainThreadTestController`. */
export interface IExtensionTestControllerProxy {
    /** Resolves after the diff of what the extension's `resolveHandler` added has reached the sink. */
    expandTest(testId: string, levels: number): Promise<void>;
    /** Resolves when the extension's `refreshHandler` has; cancellation cancels its token. */
    refreshTests(token: ICancellationToken): Promise<void>;
}

/** Upstream `MainThreadTesting`; the messages are already parsed by the host. */
export interface IExtensionTestingSink {
    registerController(controller: IWireTestController, proxy: IExtensionTestControllerProxy): void;
    updateController(patch: IWireTestControllerPatch): void;
    unregisterController(controllerId: string): void;
    publishDiff(diff: readonly WireTestsDiffOp[]): void;
    publishProfile(profile: IWireTestRunProfile): void;
    updateProfile(update: IWireTestRunProfileUpdate): void;
    removeProfile(controllerId: string, profileId: number): void;
    /** The subprocess is gone: its controllers go with their trees and profiles. */
    reset(): void;
}
