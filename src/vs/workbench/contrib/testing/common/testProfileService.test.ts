import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";

import { type ITestRunProfile, TestProfileService } from "./testProfileService.ts";

function profile(overrides: Partial<ITestRunProfile> = {}): ITestRunProfile {
    return {
        controllerId: "c",
        profileId: 1,
        label: "Run",
        group: 2,
        isDefault: false,
        tag: null,
        hasConfigurationHandler: false,
        supportsContinuousRun: false,
        ...overrides,
    };
}

function setup() {
    const contextKeys = new ContextKeyService();
    const service = new TestProfileService(contextKeys);
    let changes = 0;
    service.onDidChange(() => {
        changes++;
    });
    return { contextKeys, service, changes: () => changes };
}

describe("TestProfileService", () => {
    it("starts with nothing to run, debug or cover", () => {
        const { contextKeys } = setup();
        expect(contextKeys.get("testing.hasRunnableTests")).toBe(false);
        expect(contextKeys.get("testing.hasDebuggableTests")).toBe(false);
        expect(contextKeys.get("testing.hasCoverableTests")).toBe(false);
    });

    it("a Run profile turns testing.hasRunnableTests on; Debug and Coverage are kept but turn nothing on", () => {
        const { contextKeys, service, changes } = setup();
        service.addProfile(profile({ profileId: 4, group: 4, label: "Debug" }));
        service.addProfile(profile({ profileId: 8, group: 8, label: "Coverage" }));
        expect(contextKeys.get("testing.hasRunnableTests")).toBe(false);
        expect(contextKeys.get("testing.hasDebuggableTests")).toBe(false);
        expect(contextKeys.get("testing.hasCoverableTests")).toBe(false);
        service.addProfile(profile({ profileId: 2 }));
        expect(contextKeys.get("testing.hasRunnableTests")).toBe(true);
        expect(service.getControllerProfiles("c").map((p) => p.label)).toEqual(["Coverage", "Debug", "Run"]);
        expect(changes()).toBe(3);
    });

    it("defaults sort first, then by label; an update re-sorts", () => {
        const { service, changes } = setup();
        service.addProfile(profile({ profileId: 1, label: "b" }));
        service.addProfile(profile({ profileId: 2, label: "a" }));
        service.addProfile(profile({ profileId: 3, label: "c", isDefault: true }));
        expect(service.getControllerProfiles("c").map((p) => p.label)).toEqual(["c", "a", "b"]);
        service.updateProfile({ controllerId: "c", profileId: 1, update: { isDefault: true, label: "z" } });
        expect(service.getControllerProfiles("c").map((p) => p.label)).toEqual(["c", "z", "a"]);
        expect(service.getControllerProfiles("c")[1]).toMatchObject({ profileId: 1, isDefault: true, group: 2 });
        service.updateProfile({ controllerId: "c", profileId: 9, update: { label: "x" } });
        service.updateProfile({ controllerId: "zz", profileId: 1, update: { label: "x" } });
        expect(changes()).toBe(4);
    });

    it("removing one profile, then all of a controller, turns testing.hasRunnableTests back off", () => {
        const { contextKeys, service, changes } = setup();
        service.addProfile(profile({ profileId: 1 }));
        service.addProfile(profile({ profileId: 2 }));
        service.addProfile(profile({ controllerId: "d", profileId: 1, group: 4 }));
        service.removeProfile("c", 1);
        expect(service.getControllerProfiles("c").map((p) => p.profileId)).toEqual([2]);
        expect(contextKeys.get("testing.hasRunnableTests")).toBe(true);
        service.removeProfile("c", 7);
        service.removeProfile("zz");
        expect(changes()).toBe(4);
        service.removeProfile("c", 2);
        expect(service.getControllerProfiles("c")).toEqual([]);
        expect(contextKeys.get("testing.hasRunnableTests")).toBe(false);
        service.removeProfile("d");
        expect(service.getControllerProfiles("d")).toEqual([]);
        expect(changes()).toBe(6);
    });
});
