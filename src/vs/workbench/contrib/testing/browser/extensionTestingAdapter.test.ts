import { describe, expect, it, vi } from "vitest";

import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { makeTestingServices } from "../../../../../TestUtils/testingServices.ts";
import type { IExtensionTestControllerProxy } from "../../../api/common/iExtensionTestingSink.ts";
import type { IWireTestRunProfile } from "../../../api/common/testingWireTypes.ts";
function setup() {
    const services = makeTestingServices();
    const proxy: IExtensionTestControllerProxy = {
        expandTest: vi.fn(() => Promise.resolve()),
        refreshTests: vi.fn(() => Promise.resolve()),
        runTests: vi.fn(() => Promise.resolve([])),
        cancelTestRun: vi.fn(),
    };
    return { ...services, proxy };
}

function runProfile(controllerId: string, profileId = 1): IWireTestRunProfile {
    return {
        controllerId,
        profileId,
        label: "Run",
        group: 2,
        isDefault: true,
        tag: null,
        hasConfigurationHandler: false,
        supportsContinuousRun: false,
    };
}

describe("ExtensionTestingAdapter", () => {
    it("a registered controller is the TestService's, its expand and refresh go to the subprocess", async () => {
        const { tests, adapter, proxy } = setup();
        adapter.registerController({ controllerId: "c", label: "C", canRefresh: true }, proxy);
        expect(tests.getTestController("c")).toMatchObject({ id: "c", label: "C", canRefresh: true });
        await tests.expandTest("c\0f", 1);
        await tests.refreshTests("c");
        expect(proxy.expandTest).toHaveBeenCalledWith("c\0f", 1);
        expect(proxy.refreshTests).toHaveBeenCalledTimes(1);
        expect(vi.mocked(proxy.refreshTests).mock.calls[0][0]).not.toBe(CancellationTokenNone);
    });

    it("a patch changes only the fields it carries; an unknown controller is ignored", () => {
        const { tests, contextKeys, adapter, proxy } = setup();
        adapter.registerController({ controllerId: "c", label: "C", canRefresh: false }, proxy);
        adapter.updateController({ controllerId: "c", canRefresh: true });
        expect(tests.getTestController("c")).toMatchObject({ label: "C", canRefresh: true });
        expect(contextKeys.get("testing.canRefresh")).toBe(true);
        adapter.updateController({ controllerId: "c", label: "Renamed" });
        expect(tests.getTestController("c")).toMatchObject({ label: "Renamed", canRefresh: true });
        adapter.updateController({ controllerId: "zz", label: "X" });
        expect(tests.getTestController("zz")).toBeUndefined();
    });

    it("a repeated registration of an id replaces the stale one", () => {
        const { tests, adapter, proxy } = setup();
        adapter.registerController({ controllerId: "c", label: "old", canRefresh: false }, proxy);
        adapter.registerController({ controllerId: "c", label: "new", canRefresh: false }, proxy);
        adapter.unregisterController("c");
        expect(tests.getTestController("c")).toBeUndefined();
    });

    it("diffs and profiles reach the core; a profile of an unknown controller is dropped", () => {
        const { tests, profiles, contextKeys, adapter, proxy } = setup();
        adapter.publishProfile(runProfile("c"));
        expect(profiles.getControllerProfiles("c")).toEqual([]);
        adapter.registerController({ controllerId: "c", label: "C", canRefresh: false }, proxy);
        adapter.publishDiff([
            {
                op: 0,
                item: {
                    expand: 0,
                    item: {
                        extId: "c",
                        label: "C",
                        tags: [],
                        busy: false,
                        range: null,
                        description: null,
                        error: null,
                        sortText: null,
                    },
                },
            },
        ]);
        expect(tests.rootItems.map((node) => node.item.extId)).toEqual(["c"]);
        adapter.publishProfile(runProfile("c"));
        expect(contextKeys.get("testing.hasRunnableTests")).toBe(true);
        adapter.updateProfile({ controllerId: "c", profileId: 1, update: { label: "Run all" } });
        expect(profiles.getControllerProfiles("c")[0].label).toBe("Run all");
        adapter.removeProfile("c", 1);
        expect(contextKeys.get("testing.hasRunnableTests")).toBe(false);
    });

    it("unregistering drops the controller with its tests and profiles; reset drops all", () => {
        const { tests, profiles, contextKeys, adapter, proxy } = setup();
        adapter.registerController({ controllerId: "a", label: "A", canRefresh: true }, proxy);
        adapter.registerController({ controllerId: "b", label: "B", canRefresh: false }, proxy);
        adapter.publishProfile(runProfile("a"));
        adapter.publishProfile(runProfile("b"));
        adapter.unregisterController("a");
        expect(tests.getTestController("a")).toBeUndefined();
        expect(profiles.getControllerProfiles("a")).toEqual([]);
        expect(tests.getTestController("b")).toBeDefined();
        adapter.unregisterController("a");
        adapter.publishProfile(runProfile("a"));
        expect(profiles.getControllerProfiles("a")).toEqual([]);
        adapter.reset();
        expect(contextKeys.get("testing.providerCount")).toBe(0);
        expect(contextKeys.get("testing.hasRunnableTests")).toBe(false);
        adapter.reset();
    });
});
