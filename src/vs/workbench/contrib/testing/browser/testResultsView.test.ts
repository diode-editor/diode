import { describe, expect, it, vi } from "vitest";

import { setupExplorer, THEME, wireItem } from "../../../../../TestUtils/testingExplorerHarness.ts";
import { testId } from "../../../../../TestUtils/testTree.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { TestResultState, TestRunProfileBitset } from "../../../api/common/testingWireTypes.ts";
import type { IResolvedTestRunRequest, LiveTestResult } from "../common/testResult.ts";

import { CASE_NO_OUTPUT, RUN_NO_OUTPUT } from "./testResultsOutput.ts";
import { TEST_RESULTS_CONTAINER_ID, TEST_RESULTS_VIEW_ID } from "./testResultsView.ts";

// The TEST RESULTS panel: the tab while there is any result, opening on a run, the runs' tree, the output of the
// chosen run, test or message, the layout.

const { Running, Passed, Failed } = TestResultState;

const FILE = ["vitest", "math.test.ts"];
const SUITE = [...FILE, "math"];
const ADDS = [...SUITE, "adds"];
const FAILS = [...SUITE, "fails"];

const RED = "\x1b[31m";
const RESET = "\x1b[0m";

function setup(options: Parameters<typeof setupExplorer>[0] = {}) {
    return setupExplorer({ panelWidth: 100, panelHeight: 10, ...options });
}

type Harness = ReturnType<typeof setup>;

const REQUEST: IResolvedTestRunRequest = { targets: [], group: TestRunProfileBitset.Run };

/** A run with the task `vitest`; `state` reports a test of it with its chain. */
function start(harness: Harness, request: IResolvedTestRunRequest = REQUEST) {
    const result = harness.results.createLiveResult(request);
    result.addTask({ id: "t", name: "vitest", ctrlId: "vitest" });
    const state = (path: readonly string[], value: TestResultState): void => {
        result.addTestChainToRun(
            "vitest",
            path.map((_, i) =>
                wireItem(path.slice(0, i + 1), path[i], {
                    uri: "file:///w/math.test.ts",
                    range: createRange(2, 0, 2, 4),
                }),
            ),
        );
        result.updateState(testId(...path), "t", value);
    };
    return { result, state };
}

/** `adds` passed, `fails` failed with "expected 2 to be 3"; output for the run and for `fails` in red. */
function failingRun(harness: Harness): LiveTestResult {
    const { result, state } = start(harness);
    result.appendOutput("RUN v1\r\n", "t");
    state(ADDS, Passed);
    state(FAILS, Running);
    result.appendOutput(`${RED}FAIL${RESET} fails\r\n`, "t", undefined, testId(...FAILS));
    result.appendMessage(testId(...FAILS), "t", { message: "expected 2 to be 3\nat math.test.ts:3" });
    state(FAILS, Failed);
    result.markComplete();
    return result;
}

function isRegistered(harness: Harness): boolean {
    return harness.views.service.getViewContainerByViewId(TEST_RESULTS_VIEW_ID) !== null;
}

function panelTabs(harness: Harness): string[] {
    return harness.views.panelService.getViews().map((view) => view.id);
}

describe("TEST RESULTS — the tab", () => {
    it("is there while there is any result, after Terminal's order, and Clear All Results takes it away", async () => {
        const harness = setup();
        expect(isRegistered(harness)).toBe(false);
        expect(panelTabs(harness)).not.toContain(TEST_RESULTS_CONTAINER_ID);
        failingRun(harness);
        expect(isRegistered(harness)).toBe(true);
        expect(panelTabs(harness)).toContain(TEST_RESULTS_CONTAINER_ID);
        expect(harness.views.service.getViewContainerByViewId(TEST_RESULTS_VIEW_ID)).toBe(TEST_RESULTS_CONTAINER_ID);
        await harness.views.commands.execute("testing.clearTestResults");
        expect(isRegistered(harness)).toBe(false);
        expect(panelTabs(harness)).not.toContain(TEST_RESULTS_CONTAINER_ID);
    });

    it("a run that starts opens it without taking the keyboard (openOnTestStart by default)", () => {
        const harness = setup({ settings: { "testing.automaticallyOpenTestResults": "openOnTestStart" } });
        const opened = vi.spyOn(harness.views.service, "openView");
        start(harness);
        expect(opened).toHaveBeenCalledWith(TEST_RESULTS_VIEW_ID, false);
        expect(harness.views.service.isViewShown(TEST_RESULTS_VIEW_ID)).toBe(true);
    });

    it("a run with preserveFocus does not open it", () => {
        const harness = setup({ settings: { "testing.automaticallyOpenTestResults": "openOnTestStart" } });
        start(harness, { ...REQUEST, preserveFocus: true });
        expect(isRegistered(harness)).toBe(true);
        expect(harness.views.service.isViewShown(TEST_RESULTS_VIEW_ID)).toBe(false);
    });

    it("neverOpen leaves it closed; openExplorerOnTestStart opens the Test Explorer instead", () => {
        const never = setup({ settings: { "testing.automaticallyOpenTestResults": "neverOpen" } });
        failingRun(never);
        expect(never.views.service.isViewShown(TEST_RESULTS_VIEW_ID)).toBe(false);

        const explorer = setup({ settings: { "testing.automaticallyOpenTestResults": "openExplorerOnTestStart" } });
        const opened = vi.spyOn(explorer.views.service, "openView");
        failingRun(explorer);
        expect(opened.mock.calls).toEqual([["workbench.view.testing", false]]);
    });

    it("openOnTestFailure opens it on the first failed test, once", () => {
        const harness = setup({ settings: { "testing.automaticallyOpenTestResults": "openOnTestFailure" } });
        const opened = vi.spyOn(harness.views.service, "openView");
        const { result, state } = start(harness);
        state(ADDS, Passed);
        expect(opened).not.toHaveBeenCalled();
        state(FAILS, Failed);
        state([...SUITE, "also"], Failed);
        expect(opened.mock.calls).toEqual([[TEST_RESULTS_VIEW_ID, false]]);
        result.markComplete();
    });
});

describe("TEST RESULTS — the tree and the output", () => {
    it("the run's task with its tests and the failure's message on the right, the run's colored output on the left", async () => {
        const harness = setup();
        failingRun(harness);
        const frame = await harness.panel.waitFrame(
            (text) => text.includes("expected 2 to be 3") && text.includes("FAIL"),
        );
        const lines = frame.split("\n");
        // The content takes the left half, the tree the right one.
        const tree = lines.map((line) => line.slice(50));
        expect(tree.join("\n")).toContain("vitest");
        // The failed test first, with its parents as the description.
        const failsRow = tree.findIndex((line) => line.includes("fails"));
        const addsRow = tree.findIndex((line) => line.includes("adds"));
        expect(failsRow).toBeGreaterThan(0);
        expect(failsRow).toBeLessThan(addsRow);
        expect(tree[failsRow]).toContain("fails math ‹ math.test.ts");
        expect(tree[failsRow + 1]).toContain("expected 2 to be 3 + 1 more line");
        // The run's first task is shown: the whole output, in its colors.
        const content = lines.map((line) => line.slice(0, 50));
        expect(content[0]).toContain("RUN v1");
        const y = content.findIndex((line) => line.includes("FAIL fails"));
        const x = content[y].indexOf("FAIL");
        expect(harness.panel.fgAt(x, y)).toBe(THEME.getRequiredColor("terminal.ansiRed"));
        expect(harness.panel.fgAt(x + 5, y)).not.toBe(THEME.getRequiredColor("terminal.ansiRed"));
    });

    it("choosing a test shows its own output, choosing its message the message's text", async () => {
        const harness = setup();
        failingRun(harness);
        await harness.panel.waitFrame((text) => text.includes("RUN v1") && text.includes("+ 1 more line"));
        const row = (label: string) => {
            const lines = harness.panel.lines();
            const y = lines.findIndex((line) => line.slice(50).includes(label));
            return { x: 50 + lines[y].slice(50).indexOf(label), y };
        };
        const fails = row("fails");
        harness.panel.click(fails.x, fails.y);
        await harness.panel.waitFrame((text) => !text.includes("RUN v1") && text.includes("FAIL fails"));
        expect(harness.panel.component.currentSubject).toMatchObject({ kind: "test", testId: testId(...FAILS) });

        // The click toggled the row: the message is back with Right, the cursor goes down to it.
        harness.panel.sendKey("ArrowRight");
        harness.panel.sendKey("ArrowDown");
        const frame = await harness.panel.waitFrame((text) => text.includes("at math.test.ts:3"));
        expect(frame.split("\n")[0].slice(0, 50)).toContain("expected 2 to be 3");
    });

    it("an empty output says so: upstream's texts for a run and for a test", async () => {
        const harness = setup();
        const { result, state } = start(harness);
        state(ADDS, Passed);
        result.markComplete();
        await harness.panel.waitFrame((text) => text.includes(RUN_NO_OUTPUT.slice(0, 20)));
        harness.panel.component.tree.focus();
        harness.panel.sendKey("ArrowDown");
        await harness.panel.waitFrame((text) => text.includes(CASE_NO_OUTPUT.slice(0, 20)));
    });

    it("a live run writes into the shown output as it goes; the second run puts the first under 1 older result", async () => {
        const harness = setup();
        failingRun(harness);
        await harness.panel.waitFrame((text) => text.includes("RUN v1"));
        const { result } = start(harness);
        result.appendOutput("second run\r\n", "t");
        const frame = await harness.panel.waitFrame((text) => text.includes("second run"));
        expect(frame).not.toContain("RUN v1");
        expect(frame).toContain("1 older result");
        result.appendOutput("more\r\n", "t");
        await harness.panel.waitFrame((text) => text.includes("more"));
        result.markComplete();
        expect(harness.panel.component.currentSubject).toMatchObject({ kind: "task", result, taskIndex: 0 });
    });

    it("Toggle Tree Position puts the tree on the left and back, the choice stays", async () => {
        const harness = setup();
        failingRun(harness);
        await harness.panel.waitFrame((text) => text.includes("RUN v1"));
        await harness.views.commands.execute("testing.toggleResultsViewLayout");
        const frame = await harness.panel.waitFrame((text) => text.split("\n")[0].slice(50).includes("RUN v1"));
        expect(frame.split("\n")[0].slice(0, 50)).toContain("vitest");
        await harness.views.commands.execute("testing.toggleResultsViewLayout");
        await harness.panel.waitFrame((text) => text.split("\n")[0].slice(0, 50).includes("RUN v1"));
        expect(harness.panel.component.currentSubject?.kind).toBe("task");
    });

    it("Show Output opens the panel with the latest run's first task", async () => {
        const harness = setup({ settings: { "testing.automaticallyOpenTestResults": "neverOpen" } });
        failingRun(harness);
        const second = failingRun(harness);
        await harness.views.commands.execute("testing.showMostRecentOutput");
        expect(harness.views.service.isViewShown(TEST_RESULTS_VIEW_ID)).toBe(true);
        expect(harness.panel.component.currentSubject).toMatchObject({ kind: "task", result: second, taskIndex: 0 });
    });
});
