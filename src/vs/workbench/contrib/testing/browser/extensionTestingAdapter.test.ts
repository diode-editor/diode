import { describe, expect, it, vi } from "vitest";

import { makeTestingServices } from "../../../../../TestUtils/testingServices.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import type { IExtensionTestControllerProxy } from "../../../api/common/iExtensionTestingSink.ts";
import { type IWireTestItem, type IWireTestRunProfile, TestResultState } from "../../../api/common/testingWireTypes.ts";
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

    it("a controller's runs and cancels go to the subprocess", async () => {
        const { tests, adapter, proxy } = setup();
        adapter.registerController({ controllerId: "c", label: "C", canRefresh: false }, proxy);
        const controller = tests.getTestController("c");
        const request = { runId: "r", controllerId: "c", profileId: 1, testIds: ["c"], excludeExtIds: [] };
        await controller?.runTests([request], CancellationTokenNone);
        controller?.cancelTestRun("r", "t");
        expect(proxy.runTests).toHaveBeenCalledWith([request], CancellationTokenNone);
        expect(proxy.cancelTestRun).toHaveBeenCalledWith("r", "t");
    });

    it("a run the extension started is a live result with its profile's group; its reports land in it until it finishes", () => {
        const { results, adapter, proxy } = setup();
        adapter.registerController({ controllerId: "c", label: "C", canRefresh: false }, proxy);
        adapter.publishProfile({ ...runProfile("c", 5), group: 4 });
        adapter.startedExtensionTestRun({
            runId: "r",
            controllerId: "c",
            include: ["c"],
            exclude: [],
            profileId: 5,
            preserveFocus: true,
            persist: true,
            continuous: false,
        });
        const result = results.getResult("r");
        expect(result?.request.group).toBe(4);
        adapter.startedTestRunTask({ runId: "r", taskId: "t", controllerId: "c", name: "vitest" });
        adapter.addTestsToRun({ runId: "r", controllerId: "c", tests: [wireItem("c"), wireItem("c\0a")] });
        adapter.updateTestStateInRun({
            runId: "r",
            taskId: "t",
            testId: "c\0a",
            state: TestResultState.Failed,
            duration: 4,
        });
        adapter.appendTestMessagesInRun({
            runId: "r",
            taskId: "t",
            testId: "c\0a",
            messages: [{ message: "x" }, { message: "y" }],
        });
        adapter.appendOutputToRun({ runId: "r", taskId: "t", output: "out", testId: "c\0a" });
        adapter.updateTestStateInRun({ runId: "other", taskId: "t", testId: "c\0a", state: TestResultState.Passed });
        const state = result?.getStateById("c\0a");
        expect(state?.ownComputedState).toBe(TestResultState.Failed);
        expect(state?.ownDuration).toBe(4);
        expect(state?.tasks[0].messages.map((message) => message.message)).toEqual(["x", "y", "out"]);
        adapter.finishedTestRunTask({ runId: "r", taskId: "t" });
        expect(result?.tasks[0].running).toBe(false);
        adapter.finishedExtensionTestRun("r");
        expect(result?.completedAt).toBeDefined();
        // A completed run takes no more reports.
        adapter.startedTestRunTask({ runId: "r", taskId: "late", controllerId: "c", name: "late" });
        expect(result?.tasks).toHaveLength(1);
    });

    it("the run's profile is found by its id among the controller's", () => {
        const { results, adapter, proxy } = setup();
        adapter.registerController({ controllerId: "c", label: "C", canRefresh: false }, proxy);
        adapter.publishProfile({ ...runProfile("c", 1), group: 2 });
        adapter.publishProfile({ ...runProfile("c", 7), label: "Zed coverage", group: 8 });
        adapter.startedExtensionTestRun({
            runId: "r",
            controllerId: "c",
            include: ["c"],
            exclude: [],
            profileId: 7,
            preserveFocus: true,
            persist: true,
            continuous: false,
        });
        expect(results.getResult("r")?.request.group).toBe(8);
    });

    it("a run of an unknown profile is a Run; the subprocess's death finishes the runs it started", () => {
        const { results, adapter } = setup();
        const run = {
            runId: "r",
            controllerId: "c",
            include: ["c"],
            exclude: [],
            profileId: 9,
            preserveFocus: true,
            persist: true,
            continuous: false,
        };
        adapter.startedExtensionTestRun(run);
        adapter.startedExtensionTestRun({ ...run, runId: "s" });
        adapter.finishedExtensionTestRun("s");
        const live = results.getResult("r");
        expect(live?.request).toMatchObject({ group: 2, targets: [] });
        adapter.reset();
        expect(live?.completedAt).toBeDefined();
        expect(results.results.every((result) => result.completedAt !== undefined)).toBe(true);
    });
});

function wireItem(extId: string): IWireTestItem {
    return { extId, label: extId, tags: [], busy: false, range: null, description: null, error: null, sortText: null };
}
