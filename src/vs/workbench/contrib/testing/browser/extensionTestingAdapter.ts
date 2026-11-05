import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type {
    IExtensionTestControllerProxy,
    IExtensionTestingSink,
} from "../../../api/common/iExtensionTestingSink.ts";
import type {
    IWireTestController,
    IWireTestControllerPatch,
    IWireTestRunProfile,
    IWireTestRunProfileUpdate,
    WireTestsDiffOp,
} from "../../../api/common/testingWireTypes.ts";
import type { TestProfileService } from "../common/testProfileService.ts";
import type { ITestController, TestService } from "../common/testService.ts";

interface IRegistration {
    controller: ITestController;
    readonly registration: IDisposable;
}

/** Upstream `MainThreadTesting`: the subprocess's controllers in {@link TestService}, their profiles in {@link TestProfileService}. */
export class ExtensionTestingAdapter implements IExtensionTestingSink {
    private readonly registrations = new Map<string, IRegistration>();

    public constructor(
        private readonly tests: Pick<TestService, "registerTestController" | "updateTestController" | "publishDiff">,
        private readonly profiles: Pick<TestProfileService, "addProfile" | "updateProfile" | "removeProfile">,
    ) {}

    public registerController(
        { controllerId, label, canRefresh }: IWireTestController,
        proxy: IExtensionTestControllerProxy,
    ): void {
        const controller: ITestController = {
            id: controllerId,
            label,
            canRefresh,
            expandTest: (testId, levels) => proxy.expandTest(testId, levels),
            refreshTests: (token) => proxy.refreshTests(token),
        };
        this.registrations.set(controllerId, {
            controller,
            registration: this.tests.registerTestController(controller),
        });
    }

    public updateController({ controllerId, label, canRefresh }: IWireTestControllerPatch): void {
        const registered = this.registrations.get(controllerId);
        if (registered === undefined) return;
        registered.controller = {
            ...registered.controller,
            label: label ?? registered.controller.label,
            canRefresh: canRefresh ?? registered.controller.canRefresh,
        };
        this.tests.updateTestController(registered.controller);
    }

    public unregisterController(controllerId: string): void {
        this.registrations.get(controllerId)?.registration.dispose();
        this.registrations.delete(controllerId);
        this.profiles.removeProfile(controllerId);
    }

    public publishDiff(_controllerId: string, diff: readonly WireTestsDiffOp[]): void {
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

    public reset(): void {
        for (const controllerId of [...this.registrations.keys()]) this.unregisterController(controllerId);
    }
}
