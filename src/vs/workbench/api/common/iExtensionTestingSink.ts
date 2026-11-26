import type { ICancellationToken } from "../../../base/common/cancellation.ts";

import type {
    IWireAddTestsToRun,
    IWireExtensionTestRun,
    IWireRunControllerTestsResult,
    IWireStartControllerTests,
    IWireTestController,
    IWireTestControllerPatch,
    IWireTestMessagesInRun,
    IWireTestOutputInRun,
    IWireTestRunProfile,
    IWireTestRunProfileUpdate,
    IWireTestRunTask,
    IWireTestRunTaskId,
    IWireTestStateInRun,
    WireTestsDiffOp,
} from "./testingWireTypes.ts";

/** One controller in the subprocess: upstream `IMainThreadTestController`. */
export interface IExtensionTestControllerProxy {
    /** Resolves after the diff of what the extension's `resolveHandler` added has reached the sink. */
    expandTest(testId: string, levels: number): Promise<void>;
    /** Resolves when the extension's `refreshHandler` has; cancellation cancels its token. */
    refreshTests(token: ICancellationToken): Promise<void>;
    /**
     * Upstream `runTests`: the profiles' `runHandler`s; resolves when they have settled and the run's `TestRun`s
     * have ended. Cancellation cancels the handlers' tokens; rejects if the subprocess dies meanwhile.
     */
    runTests(
        requests: readonly IWireStartControllerTests[],
        token: ICancellationToken,
    ): Promise<IWireRunControllerTestsResult[]>;
    /**
     * Upstream `$cancelExtensionTestRun`: the same function for every controller of one subprocess, so a run of
     * several of its controllers is cancelled once.
     */
    readonly cancelTestRun: (runId: string, taskId?: string) => void;
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
    startedExtensionTestRun(run: IWireExtensionTestRun): void;
    finishedExtensionTestRun(runId: string): void;
    startedTestRunTask(task: IWireTestRunTask): void;
    finishedTestRunTask(task: IWireTestRunTaskId): void;
    addTestsToRun(add: IWireAddTestsToRun): void;
    updateTestStateInRun(update: IWireTestStateInRun): void;
    appendTestMessagesInRun(messages: IWireTestMessagesInRun): void;
    appendOutputToRun(output: IWireTestOutputInRun): void;
    /** The subprocess is gone: its controllers go with their trees and profiles, its own runs are finished. */
    reset(): void;
}
