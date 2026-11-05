import { Emitter, type Event } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import {
    type ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IWireTestRunProfile,
    type IWireTestRunProfileUpdate,
    TestRunProfileBitset,
} from "../../../api/common/testingWireTypes.ts";

export type ITestRunProfile = IWireTestRunProfile;

// Stryker disable next-line StringLiteral: token() returns a unique Token matched by reference; the string is a label
export const TestProfileServiceDIToken = token<TestProfileService>("TestProfileService");

/** Upstream `sorter`: defaults first, then by label. */
function compareProfiles(a: ITestRunProfile, b: ITestRunProfile): number {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.label.localeCompare(b.label);
}

/**
 * Upstream `TestProfileService`: the run profiles of every controller and `testing.hasRunnableTests`.
 * Deviation: Debug and Coverage profiles are kept but offered nowhere, `testing.hasDebuggableTests` and
 * `testing.hasCoverableTests` stay `false` (no debugger; coverage is a later wave).
 */
export class TestProfileService extends Disposable {
    public static dependencies = [ContextKeyServiceDIToken] as const;

    private readonly profiles = new Map<string, ITestRunProfile[]>();
    private readonly onDidChangeEmitter = this.register(new Emitter<void>());
    public readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    public constructor(private readonly contextKeys: ContextKeyService) {
        super();
        contextKeys.set("testing.hasDebuggableTests", false);
        contextKeys.set("testing.hasCoverableTests", false);
        this.refreshContextKeys();
    }

    public addProfile(profile: ITestRunProfile): void {
        const list = this.profiles.get(profile.controllerId) ?? [];
        list.push(profile);
        list.sort(compareProfiles);
        this.profiles.set(profile.controllerId, list);
        this.changed();
    }

    public updateProfile({ controllerId, profileId, update }: IWireTestRunProfileUpdate): void {
        const list = this.profiles.get(controllerId);
        const index = list?.findIndex((profile) => profile.profileId === profileId) ?? -1;
        if (list === undefined || index === -1) return;
        list[index] = { ...list[index], ...update };
        list.sort(compareProfiles);
        this.changed();
    }

    /** Without `profileId` — all of the controller's profiles. */
    public removeProfile(controllerId: string, profileId?: number): void {
        const list = this.profiles.get(controllerId);
        if (list === undefined) return;
        const next = profileId === undefined ? [] : list.filter((profile) => profile.profileId !== profileId);
        if (next.length === list.length) return;
        if (next.length === 0) this.profiles.delete(controllerId);
        else this.profiles.set(controllerId, next);
        this.changed();
    }

    public getControllerProfiles(controllerId: string): readonly ITestRunProfile[] {
        return this.profiles.get(controllerId) ?? [];
    }

    private changed(): void {
        this.refreshContextKeys();
        this.onDidChangeEmitter.fire();
    }

    private refreshContextKeys(): void {
        const hasRun = [...this.profiles.values()].some((list) =>
            list.some((profile) => profile.group === TestRunProfileBitset.Run),
        );
        this.contextKeys.set("testing.hasRunnableTests", hasRun);
    }
}
