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
    TestId,
    TestRunProfileBitset,
    type TestRunProfileGroup,
} from "../../../api/common/testingWireTypes.ts";

import type { ITestNode } from "./testService.ts";

export type ITestRunProfile = IWireTestRunProfile;

// Stryker disable next-line StringLiteral: token() returns a unique Token matched by reference; the string is a label
export const TestProfileServiceDIToken = token<TestProfileService>("TestProfileService");

/** What the capabilities need of a test: its controller and its item. */
export type ITestCapabilitySubject = Pick<ITestNode, "controllerId" | "item">;

/** Upstream `canUseProfileWithTest` among the test's own controller's profiles: its tag is on the test (a root takes any). */
function canRunTest(profile: ITestRunProfile, test: ITestCapabilitySubject): boolean {
    return (
        TestId.parentId(test.item.extId) === undefined || profile.tag === null || test.item.tags.includes(profile.tag)
    );
}

/** Upstream `sorter`: defaults first, then by label. */
function compareProfiles(a: ITestRunProfile, b: ITestRunProfile): number {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.label.localeCompare(b.label);
}

/** Upstream `capabilityContextKeys`: a test's menus see what it can do. Coverage is a later wave: never. */
export function capabilityContextKeys(capabilities: number): { [key: string]: boolean } {
    return {
        "testing.hasRunnableTests": (capabilities & TestRunProfileBitset.Run) !== 0,
        "testing.hasDebuggableTests": (capabilities & TestRunProfileBitset.Debug) !== 0,
    };
}

/**
 * Upstream `TestProfileService`: the run profiles of every controller, `testing.hasRunnableTests` and
 * `testing.hasDebuggableTests`. Deviation: Coverage profiles are kept but offered nowhere, `testing.hasCoverableTests`
 * stays `false` (coverage is a later wave).
 */
export class TestProfileService extends Disposable {
    public static dependencies = [ContextKeyServiceDIToken] as const;

    private readonly profiles = new Map<string, ITestRunProfile[]>();
    private readonly onDidChangeEmitter = this.register(new Emitter<void>());
    public readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    public constructor(private readonly contextKeys: ContextKeyService) {
        super();
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
        // Stryker disable next-line ArrayDeclaration: equivalent — a controller without profiles has none with the id either way
        const list = this.profiles.get(controllerId) ?? [];
        const index = list.findIndex((profile) => profile.profileId === profileId);
        if (index === -1) return;
        list[index] = { ...list[index], ...update };
        list.sort(compareProfiles);
        this.changed();
    }

    /** Without `profileId` — all of the controller's profiles. */
    public removeProfile(controllerId: string, profileId?: number): void {
        const list = this.profiles.get(controllerId) ?? [];
        const next = profileId === undefined ? [] : list.filter((profile) => profile.profileId !== profileId);
        if (next.length === list.length) return;
        this.profiles.set(controllerId, next);
        this.changed();
    }

    public getControllerProfiles(controllerId: string): readonly ITestRunProfile[] {
        return this.profiles.get(controllerId) ?? [];
    }

    /** Upstream `getDefaultProfileForTest`: the controller's first profile of the group that can run the test. */
    public getDefaultProfileForTest(group: TestRunProfileGroup, test: ITestNode): ITestRunProfile | undefined {
        return this.getControllerProfiles(test.controllerId).find(
            (profile) => profile.group === group && canRunTest(profile, test),
        );
    }

    /** Upstream `capabilitiesForTest`: the groups of the test's controller's profiles that can run it. */
    public capabilitiesForTest(test: ITestCapabilitySubject): number {
        let capabilities = 0;
        for (const profile of this.getControllerProfiles(test.controllerId)) {
            if (canRunTest(profile, test)) capabilities |= profile.group;
        }
        return capabilities;
    }

    private changed(): void {
        this.refreshContextKeys();
        this.onDidChangeEmitter.fire();
    }

    private refreshContextKeys(): void {
        let capabilities = 0;
        for (const list of this.profiles.values()) for (const profile of list) capabilities |= profile.group;
        const keys = capabilityContextKeys(capabilities);
        this.contextKeys.set("testing.hasRunnableTests", keys["testing.hasRunnableTests"]);
        this.contextKeys.set("testing.hasDebuggableTests", keys["testing.hasDebuggableTests"]);
    }
}
