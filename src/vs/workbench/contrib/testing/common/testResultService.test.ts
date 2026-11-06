import { describe, expect, it } from "vitest";

import { testId } from "../../../../../TestUtils/testTree.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { type IWireTestItem, TestResultState, TestRunProfileBitset } from "../../../api/common/testingWireTypes.ts";

import type { LiveTestResult } from "./testResult.ts";
import { RETAIN_MAX_RESULTS, TestResultService } from "./testResultService.ts";

const REQUEST = { targets: [], group: TestRunProfileBitset.Run } as const;

function item(...path: string[]): IWireTestItem {
    return { extId: testId(...path), label: path.at(-1) ?? "", tags: [], busy: false, range: null, description: null, error: null, sortText: null };
}

function setup() {
    const contextKeys = new ContextKeyService();
    const service = new TestResultService(contextKeys);
    const events: string[] = [];
    service.onResultsChanged((event) => {
        if ("started" in event) events.push("started");
        else if ("completed" in event) events.push("completed");
        else events.push(`removed ${String(event.removed.length)}`);
    });
    return { contextKeys, service, events };
}

/** A result where `ctrl/a` got `state` in task `t`. */
function withState(result: LiveTestResult, state: TestResultState): LiveTestResult {
    result.addTask({ id: "t", name: "t", ctrlId: "ctrl" });
    result.addTestChainToRun("ctrl", [item("ctrl"), item("ctrl", "a")]);
    result.updateState(testId("ctrl", "a"), "t", state);
    return result;
}

describe("TestResultService", () => {
    it("a new run is live at once: testing.isRunning and hasAnyResults; completed runs follow the live ones, the latest first", () => {
        const { contextKeys, service, events } = setup();
        expect(contextKeys.get("testing.isRunning")).toBe(false);
        expect(contextKeys.get("testing.hasAnyResults")).toBe(false);
        const first = service.createLiveResult(REQUEST);
        const second = service.createLiveResult(REQUEST);
        expect(contextKeys.get("testing.isRunning")).toBe(true);
        expect(contextKeys.get("testing.hasAnyResults")).toBe(true);
        expect(service.results).toEqual([second, first]);
        second.markComplete();
        expect(contextKeys.get("testing.isRunning")).toBe(true);
        expect(service.results).toEqual([first, second]);
        first.markComplete();
        expect(contextKeys.get("testing.isRunning")).toBe(false);
        expect(service.results).toEqual([second, first]);
        expect(events).toEqual(["started", "started", "completed", "completed"]);
        expect(service.getResult(first.id)).toBe(first);
        expect(service.getResult("nope")).toBeUndefined();
        expect(first.id).not.toBe(second.id);
    });

    it("a test's state is the one of the latest run where it is not unset", () => {
        const { service } = setup();
        const old = withState(service.createLiveResult(REQUEST), TestResultState.Failed);
        old.markComplete();
        const latest = service.createLiveResult(REQUEST);
        latest.addTask({ id: "t", name: "t", ctrlId: "ctrl" });
        latest.addTestChainToRun("ctrl", [item("ctrl"), item("ctrl", "a")]);
        // In the latest run but not reported yet: the old state shows.
        expect(service.getStateById(testId("ctrl", "a"))?.[0]).toBe(old);
        latest.updateState(testId("ctrl", "a"), "t", TestResultState.Passed);
        const [result, state] = service.getStateById(testId("ctrl", "a")) ?? [];
        expect(result).toBe(latest);
        expect(state?.computedState).toBe(TestResultState.Passed);
        expect(service.getStateById(testId("ctrl", "gone"))).toBeUndefined();
    });

    it("onTestChanged forwards the runs' changes", () => {
        const { service } = setup();
        const changes: string[] = [];
        service.onTestChanged((change) => changes.push(`${change.item.item.label}:${change.reason}`));
        withState(service.createLiveResult(REQUEST), TestResultState.Passed);
        expect(changes).toEqual(["a:ownState", "ctrl:computedState"]);
    });

    it("clear drops the completed runs and keeps the live ones", () => {
        const { contextKeys, service, events } = setup();
        const done = service.createLiveResult(REQUEST);
        done.markComplete();
        const live = service.createLiveResult(REQUEST);
        events.length = 0;
        service.clear();
        expect(service.results).toEqual([live]);
        expect(contextKeys.get("testing.hasAnyResults")).toBe(true);
        live.markComplete();
        service.clear();
        expect(service.results).toEqual([]);
        expect(contextKeys.get("testing.hasAnyResults")).toBe(false);
        expect(events).toEqual(["removed 1", "completed", "removed 1"]);
        // A cleared run's changes no longer reach the service.
        const changes: unknown[] = [];
        service.onTestChanged((change) => changes.push(change));
        withState(done, TestResultState.Passed);
        expect(changes).toEqual([]);
    });

    it(`keeps the latest ${String(RETAIN_MAX_RESULTS)} runs`, () => {
        const { service } = setup();
        const first = service.createLiveResult(REQUEST);
        first.markComplete();
        for (let i = 0; i < RETAIN_MAX_RESULTS; i++) service.createLiveResult(REQUEST).markComplete();
        expect(service.results).toHaveLength(RETAIN_MAX_RESULTS);
        expect(service.results.includes(first)).toBe(false);
    });

    it("a run the extension started keeps its id, its request and the group of its profile", () => {
        const { service } = setup();
        const run = {
            runId: "ext",
            controllerId: "ctrl",
            include: ["ctrl"],
            exclude: [testId("ctrl", "b")],
            profileId: 7,
            preserveFocus: false,
            persist: false,
            continuous: true,
        };
        const withProfile = service.createExtensionLiveResult(run, TestRunProfileBitset.Debug);
        expect(withProfile.id).toBe("ext");
        expect(withProfile.persist).toBe(false);
        expect(withProfile.request).toEqual({
            preserveFocus: false,
            targets: [{ profileId: 7, controllerId: "ctrl", testIds: ["ctrl"] }],
            exclude: [testId("ctrl", "b")],
            continuous: true,
            group: TestRunProfileBitset.Debug,
        });
        expect(service.createExtensionLiveResult({ ...run, runId: "x" }, undefined).request).toMatchObject({
            targets: [],
            group: TestRunProfileBitset.Run,
        });
        expect(service.createExtensionLiveResult({ ...run, runId: "y", profileId: null }, TestRunProfileBitset.Run).request.targets).toEqual([]);
    });

    it("disposing the service disposes its runs", () => {
        const { service } = setup();
        const result = service.createLiveResult(REQUEST);
        const completions: unknown[] = [];
        result.onComplete(() => completions.push(1));
        service.dispose();
        result.markComplete();
        expect(completions).toEqual([]);
    });
});
