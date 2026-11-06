import type {
    IExtensionTestControllerProxy,
    IExtensionTestingSink,
} from "../../../api/common/iExtensionTestingSink.ts";
import type {
    IWireAddTestsToRun,
    IWireExtensionTestRun,
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
} from "../../../api/common/testingWireTypes.ts";
import type { TestProfileService } from "../common/testProfileService.ts";
import type { LiveTestResult } from "../common/testResult.ts";
import type { TestResultService } from "../common/testResultService.ts";
import type { ITestControllerRegistration, TestService } from "../common/testService.ts";

/**
 * Upstream `MainThreadTesting`: the subprocess's controllers in {@link TestService}, their profiles in
 * {@link TestProfileService}, the reports of their runs in the live results of {@link TestResultService}.
 */
export class ExtensionTestingAdapter implements IExtensionTestingSink {
    private readonly registrations = new Map<string, ITestControllerRegistration>();
    /** The runs the extensions started themselves: the subprocess's death finishes them. */
    private readonly extensionRuns = new Set<string>();

    public constructor(
        private readonly tests: Pick<TestService, "registerTestController" | "publishDiff">,
        private readonly profiles: Pick<
            TestProfileService,
            "addProfile" | "updateProfile" | "removeProfile" | "getControllerProfiles"
        >,
        private readonly results: Pick<TestResultService, "getResult" | "createExtensionLiveResult">,
    ) {}

    public registerController(
        { controllerId, label, canRefresh }: IWireTestController,
        proxy: IExtensionTestControllerProxy,
    ): void {
        this.registrations.set(
            controllerId,
            this.tests.registerTestController({
                id: controllerId,
                label,
                canRefresh,
                expandTest: (testId, levels) => proxy.expandTest(testId, levels),
                refreshTests: (token) => proxy.refreshTests(token),
                runTests: (requests, token) => proxy.runTests(requests, token),
                cancelTestRun: proxy.cancelTestRun,
            }),
        );
    }

    public updateController({ controllerId, label, canRefresh }: IWireTestControllerPatch): void {
        this.registrations.get(controllerId)?.update({ label, canRefresh });
    }

    public unregisterController(controllerId: string): void {
        this.registrations.get(controllerId)?.dispose();
        this.registrations.delete(controllerId);
        this.profiles.removeProfile(controllerId);
    }

    public publishDiff(diff: readonly WireTestsDiffOp[]): void {
        this.tests.publishDiff(diff);
    }

    /** A profile of an unknown controller is dropped, as upstream. */
    public publishProfile(profile: IWireTestRunProfile): void {
        if (this.registrations.has(profile.controllerId)) this.profiles.addProfile(profile);
    }

    public updateProfile(update: IWireTestRunProfileUpdate): void {
        this.profiles.updateProfile(update);
    }

    public removeProfile(controllerId: string, profileId: number): void {
        this.profiles.removeProfile(controllerId, profileId);
    }

    /** Upstream `$startedExtensionTestRun`. */
    public startedExtensionTestRun(run: IWireExtensionTestRun): void {
        const profile = this.profiles
            .getControllerProfiles(run.controllerId)
            .find((candidate) => candidate.profileId === run.profileId);
        this.results.createExtensionLiveResult(run, profile?.group);
        this.extensionRuns.add(run.runId);
    }

    /** Upstream `$finishedExtensionTestRun`. */
    public finishedExtensionTestRun(runId: string): void {
        // Stryker disable next-line CallExpression: hygiene — a finished run left in the set is finished again on reset, which completes nothing
        this.extensionRuns.delete(runId);
        this.withLiveRun(runId, (result) => {
            result.markComplete();
        });
    }

    public startedTestRunTask({ runId, taskId, controllerId, name }: IWireTestRunTask): void {
        this.withLiveRun(runId, (result) => {
            result.addTask({ id: taskId, name, ctrlId: controllerId });
        });
    }

    public finishedTestRunTask({ runId, taskId }: IWireTestRunTaskId): void {
        this.withLiveRun(runId, (result) => {
            result.markTaskComplete(taskId);
        });
    }

    public addTestsToRun({ controllerId, runId, tests }: IWireAddTestsToRun): void {
        this.withLiveRun(runId, (result) => {
            result.addTestChainToRun(controllerId, tests);
        });
    }

    public updateTestStateInRun({ runId, taskId, testId, state, duration }: IWireTestStateInRun): void {
        this.withLiveRun(runId, (result) => {
            result.updateState(testId, taskId, state, duration);
        });
    }

    public appendTestMessagesInRun({ runId, taskId, testId, messages }: IWireTestMessagesInRun): void {
        this.withLiveRun(runId, (result) => {
            for (const message of messages) result.appendMessage(testId, taskId, message);
        });
    }

    public appendOutputToRun({ runId, taskId, output, location, testId }: IWireTestOutputInRun): void {
        this.withLiveRun(runId, (result) => {
            result.appendOutput(output, taskId, location, testId);
        });
    }

    public reset(): void {
        for (const controllerId of [...this.registrations.keys()]) this.unregisterController(controllerId);
        for (const runId of [...this.extensionRuns]) this.finishedExtensionTestRun(runId);
    }

    /** Upstream `withLiveRun`: a report for a completed or unknown run is dropped. */
    private withLiveRun(runId: string, fn: (result: LiveTestResult) => void): void {
        const result = this.results.getResult(runId);
        if (result !== undefined && result.completedAt === undefined) fn(result);
    }
}
