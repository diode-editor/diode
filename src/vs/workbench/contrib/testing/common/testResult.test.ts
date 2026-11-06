import { describe, expect, it } from "vitest";

import { testId } from "../../../../../TestUtils/testTree.ts";
import { type IWireTestItem, TestResultState, TestRunProfileBitset } from "../../../api/common/testingWireTypes.ts";

import { type ITestResultItemChange, LiveTestResult } from "./testResult.ts";

const { Unset, Queued, Running, Passed, Failed, Skipped, Errored } = TestResultState;

function item(...path: string[]): IWireTestItem {
    return {
        extId: testId(...path),
        label: path[path.length - 1],
        tags: [],
        busy: false,
        range: null,
        description: null,
        error: null,
        sortText: null,
    };
}

/** `ctrl` → `math` → `adds`, `fails` in one task `t`. */
function setup() {
    let clock = 1000;
    const result = new LiveTestResult("r", true, { targets: [], group: TestRunProfileBitset.Run }, 0, () => clock);
    const changes: string[] = [];
    result.onChange((change: ITestResultItemChange) => {
        changes.push(`${change.item.item.label}:${change.reason}`);
    });
    result.addTask({ id: "t", name: "vitest", ctrlId: "ctrl" });
    result.addTestChainToRun("ctrl", [item("ctrl"), item("ctrl", "math"), item("ctrl", "math", "adds")]);
    result.addTestChainToRun("ctrl", [item("ctrl", "math"), item("ctrl", "math", "fails")]);
    const state = (...path: string[]) => {
        const entry = result.getStateById(testId(...path));
        return [entry?.ownComputedState, entry?.computedState];
    };
    return {
        result,
        changes,
        state,
        tick: (ms: number) => {
            clock += ms;
        },
    };
}

describe("LiveTestResult", () => {
    it("a test's own state raises its ancestors' by priority; counts follow the own states", () => {
        const { result, state, changes } = setup();
        expect(result.startedAt).toBe(1000);
        expect([...result.tests].map((test) => test.item.label)).toEqual(["ctrl", "math", "adds", "fails"]);
        expect(result.counts[Unset]).toBe(4);
        result.updateState(testId("ctrl", "math", "adds"), "t", Running);
        expect(state("ctrl", "math", "adds")).toEqual([Running, Running]);
        expect(state("ctrl", "math")).toEqual([Unset, Running]);
        expect(state("ctrl")).toEqual([Unset, Running]);
        result.updateState(testId("ctrl", "math", "adds"), "t", Passed, 12);
        result.updateState(testId("ctrl", "math", "fails"), "t", Failed, 3);
        expect(state("ctrl", "math")).toEqual([Unset, Failed]);
        expect(state("ctrl")).toEqual([Unset, Failed]);
        expect(result.counts[Passed]).toBe(1);
        expect(result.counts[Failed]).toBe(1);
        expect(result.counts[Unset]).toBe(2);
        expect(result.getStateById(testId("ctrl", "math", "adds"))?.ownDuration).toBe(12);
        expect(changes).toEqual([
            "adds:ownState",
            "math:computedState",
            "ctrl:computedState",
            "adds:ownState",
            "math:computedState",
            "ctrl:computedState",
            "fails:ownState",
            "math:computedState",
            "ctrl:computedState",
        ]);
    });

    it("all children skipped make an unset parent skipped (upstream #131537); errored outranks failed", () => {
        const { result, state } = setup();
        result.updateState(testId("ctrl", "math", "adds"), "t", Skipped);
        expect(state("ctrl", "math")).toEqual([Unset, Skipped]);
        result.updateState(testId("ctrl", "math", "fails"), "t", Skipped);
        expect(state("ctrl", "math")).toEqual([Unset, Skipped]);
        const other = setup();
        other.result.updateState(testId("ctrl", "math", "adds"), "t", Errored);
        other.result.updateState(testId("ctrl", "math", "fails"), "t", Failed);
        expect(other.state("ctrl")).toEqual([Unset, Errored]);
        other.result.updateState(testId("ctrl", "math"), "t", Queued);
        expect(other.state("ctrl", "math")).toEqual([Queued, Errored]);
    });

    it("a terminal state is not replaced by a lower or a non-terminal one", () => {
        const { result, state } = setup();
        const adds = testId("ctrl", "math", "adds");
        result.updateState(adds, "t", Failed);
        result.updateState(adds, "t", Passed);
        result.updateState(adds, "t", Running);
        expect(state("ctrl", "math", "adds")).toEqual([Failed, Failed]);
        result.updateState(adds, "t", Errored);
        expect(state("ctrl", "math", "adds")).toEqual([Errored, Errored]);
        // From a non-terminal state anything goes.
        const fails = testId("ctrl", "math", "fails");
        result.updateState(fails, "t", Running);
        result.updateState(fails, "t", Queued);
        expect(state("ctrl", "math", "fails")).toEqual([Queued, Queued]);
    });

    it("the own state is the highest of the tasks'; the duration the longest", () => {
        const { result, state } = setup();
        result.addTask({ id: "t2", name: "second", ctrlId: "ctrl" });
        const adds = testId("ctrl", "math", "adds");
        result.updateState(adds, "t", Passed, 5);
        result.updateState(adds, "t2", Failed, 2);
        expect(state("ctrl", "math", "adds")).toEqual([Failed, Failed]);
        expect(result.getStateById(adds)?.tasks.map((task) => [task.state, task.duration])).toEqual([
            [Passed, 5],
            [Failed, 2],
        ]);
        expect(result.getStateById(adds)?.ownDuration).toBe(5);
        expect(result.tasks.map((task) => task.name)).toEqual(["vitest", "second"]);
    });

    it("a duration alone changes the test; an unknown test or task is ignored", () => {
        const { result, changes } = setup();
        const adds = testId("ctrl", "math", "adds");
        result.updateState(adds, "t", Running);
        changes.length = 0;
        result.updateState(adds, "t", Running, 7);
        expect(changes).toEqual(["adds:ownState"]);
        result.updateState(adds, "t", Running);
        result.updateState(testId("ctrl", "gone"), "t", Passed);
        result.updateState(adds, "nope", Passed);
        result.appendMessage(adds, "nope", { message: "x" });
        result.appendMessage(testId("ctrl", "gone"), "t", { message: "x" });
        result.appendOutput("x", "nope");
        expect(changes).toEqual(["adds:ownState"]);
    });

    it("messages and output are kept per test and task; output without a test is the task's", () => {
        const { result, changes } = setup();
        const adds = testId("ctrl", "math", "adds");
        result.appendMessage(adds, "t", { message: "expected 2", expected: "2", actual: "3" });
        result.appendOutput("first\n", "t", undefined, adds);
        const long = "y".repeat(120);
        result.appendOutput(long, "t");
        const [task] = result.tasks;
        expect(task.output).toBe(`first\n${long}`);
        expect(result.getStateById(adds)?.tasks[0].messages).toEqual([
            { type: "error", message: "expected 2", expected: "2", actual: "3" },
            { type: "output", message: "first\n", offset: 0, length: 6, location: undefined },
        ]);
        expect(task.otherMessages).toEqual([
            { type: "output", message: `${"y".repeat(100)}…`, offset: 6, length: 120, location: undefined },
        ]);
        expect(changes).toEqual(["adds:message", "adds:message"]);
    });

    it("completing a task skips its queued and running tests; completing the run completes its tasks once", () => {
        const { result, state, tick } = setup();
        result.addTask({ id: "t2", name: "second", ctrlId: "ctrl" });
        const adds = testId("ctrl", "math", "adds");
        const fails = testId("ctrl", "math", "fails");
        result.updateState(adds, "t", Running);
        result.updateState(fails, "t", Queued);
        result.updateState(fails, "t2", Running);
        result.markTaskComplete("t");
        expect(result.tasks.map((task) => task.running)).toEqual([false, true]);
        expect(state("ctrl", "math", "adds")).toEqual([Skipped, Skipped]);
        // The second task still runs it.
        expect(state("ctrl", "math", "fails")).toEqual([Running, Running]);
        result.markTaskComplete("t");
        result.markTaskComplete("nope");
        expect(result.completedAt).toBeUndefined();
        let completed = 0;
        result.onComplete(() => completed++);
        tick(2500);
        result.markComplete();
        result.markComplete();
        expect(completed).toBe(1);
        expect(result.completedAt).toBe(3500);
        expect(result.tasks.map((task) => task.running)).toEqual([false, false]);
        expect(state("ctrl", "math", "fails")).toEqual([Skipped, Skipped]);
    });

    it("a test added after a task has an unset state in it; a known test in a chain is not added twice", () => {
        const { result } = setup();
        result.addTestChainToRun("ctrl", [item("ctrl", "math"), item("ctrl", "math", "adds")]);
        result.addTestChainToRun("ctrl", []);
        expect([...result.tests]).toHaveLength(4);
        expect(result.getStateById(testId("ctrl", "math", "adds"))?.tasks).toEqual([{ state: Unset, messages: [] }]);
        expect(result.getStateById(testId("ctrl", "math"))?.controllerId).toBe("ctrl");
    });
});
