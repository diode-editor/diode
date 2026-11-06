import { describe, expect, it, vi } from "vitest";

import { add, setupExplorer, THEME, update, wireItem } from "../../../../../TestUtils/testingExplorerHarness.ts";
import { testId } from "../../../../../TestUtils/testTree.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import {
    type IWireTestItem,
    TestItemExpandState,
    TestResultState,
    TestRunProfileBitset,
} from "../../../api/common/testingWireTypes.ts";
import type { LiveTestResult } from "../common/testResult.ts";

import { SUMMARY_RENDER_INTERVAL, TESTING_VIEW_SORTING_STATE } from "./testingExplorerView.ts";

// The Test Explorer during and after runs: the title's Run/Cancel, the row's Run Test, the states and durations in
// the tree, the summary, reruns, Clear All Results, the state filters and the sortings.

const { NotExpandable, Expandable, Expanded } = TestItemExpandState;
const { Queued, Running, Passed, Failed, Errored, Skipped } = TestResultState;

const URI = "file:///w/src/math.test.ts";
const ROOT = ["vitest"];
const FILE = ["vitest", "math.test.ts"];
const SUITE = [...FILE, "math"];
const ADDS = [...SUITE, "adds"];
const FAILS = [...SUITE, "fails"];
const SLOW = [...SUITE, "slow"];

function item(path: readonly string[], line?: number): IWireTestItem {
    return wireItem(path, path[path.length - 1], {
        uri: line === undefined ? undefined : URI,
        range: line === undefined ? null : createRange(line, 4, line, 20),
    });
}

/** `math.test.ts` → `math` → `adds`, `fails`, `slow` (in file order), shown and expanded; a Run profile. */
async function withTests(options: Parameters<typeof setupExplorer>[0] = {}) {
    const explorer = setupExplorer({ height: 14, ...options });
    explorer.registerController("vitest", "Vitest");
    explorer.profiles.addProfile({
        controllerId: "vitest",
        profileId: 1,
        label: "Run",
        group: TestRunProfileBitset.Run,
        isDefault: true,
        tag: null,
        hasConfigurationHandler: false,
        supportsContinuousRun: false,
    });
    explorer.tests.publishDiff([
        add(wireItem(ROOT, "Vitest"), Expanded),
        add(item(FILE), Expanded),
        add(item(SUITE, 1), NotExpandable),
        add(item(ADDS, 2), NotExpandable),
        add(item(FAILS, 3), NotExpandable),
        add(item(SLOW, 4), NotExpandable),
    ]);
    await explorer.waitFrame((text) => text.includes(" math.test.ts"));
    for (const [label, next] of [
        ["math.test.ts", " math"],
        ["math", " slow"],
    ] as const) {
        const { x, y } = explorer.row(label);
        explorer.click(x, y);
        await explorer.waitFrame((text) => text.includes(next));
    }
    return explorer;
}

type Explorer = Awaited<ReturnType<typeof withTests>>;

/** The run the core asked for, as the extension reports it: one task, the chain of every test it touches. */
function report(explorer: Explorer, index = 0) {
    const request = explorer.runs[index];
    const result = explorer.results.getResult(request.requests[0].runId)!;
    result.addTask({ id: "t", name: "vitest", ctrlId: "vitest" });
    const state = (path: readonly string[], value: TestResultState, duration?: number): void => {
        const chain = path.map((_, i) => wireItem(path.slice(0, i + 1)));
        result.addTestChainToRun("vitest", chain);
        result.updateState(testId(...path), "t", value, duration);
    };
    const end = (): void => {
        result.markTaskComplete("t");
        request.finish();
    };
    return { request, result, state, end };
}

/** Runs everything through the title's Run Tests and reports `adds` passed in 12 ms, `fails` failed in 3 ms. */
async function runAndFail(explorer: Explorer) {
    void explorer.views.commands.execute("testing.runSelected");
    await vi.waitFor(() => {
        expect(explorer.runs).toHaveLength(1);
    });
    const run = report(explorer);
    run.state(ADDS, Passed, 12);
    run.state(FAILS, Failed, 3);
    run.end();
    await vi.waitFor(() => {
        expect(run.result.completedAt).toBeDefined();
    });
    return run;
}

function titleButtons(explorer: Explorer): string {
    return explorer.lines()[0];
}

/** The entries of the last context menu, a separator as "-". */
function menuEntries(explorer: Explorer) {
    return explorer.views.shown.at(-1)?.getEntries?.() ?? [];
}

function menuLabels(explorer: Explorer): string[] {
    return menuEntries(explorer).map((entry) => (entry.type === "separator" ? "-" : entry.label));
}

function menuIcons(explorer: Explorer): (string | undefined)[] {
    return menuEntries(explorer).map((entry) => (entry.type === undefined || entry.type === "item" ? entry.icon : "-"));
}

function selectMenu(explorer: Explorer, label: string): void {
    const entry = menuEntries(explorer).find(
        (candidate) => candidate.type !== "separator" && candidate.label === label,
    );
    if (entry === undefined || entry.type === "separator" || entry.type === "submenu") throw new Error(`no "${label}"`);
    entry.onSelect?.();
}

describe("Test Explorer — a run from the title", () => {
    it("Run Tests runs every test after Save All; the run shows at once: spinners, Cancel instead of Run, the ticking summary", async () => {
        let clock = 10_000;
        const explorer = await withTests({ now: () => clock, progress: { delayMs: 0 } });
        expect(titleButtons(explorer)).toContain("▷");
        expect(explorer.lines()[2]).toContain("No test results yet.");
        void explorer.views.commands.execute("testing.runSelected");
        expect(explorer.saves).toHaveLength(1);
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(1);
        });
        expect(explorer.runs[0].requests).toEqual([
            {
                runId: expect.any(String) as string,
                controllerId: "vitest",
                profileId: 1,
                testIds: ["vitest"],
                excludeExtIds: [],
            },
        ]);
        expect(explorer.views.contextKeys.get("testing.isRunning")).toBe(true);
        await vi.waitFor(() => {
            expect(titleButtons(explorer)).toContain("■");
        });
        expect(titleButtons(explorer)).not.toContain("▷");
        const run = report(explorer);
        run.state(ADDS, Running);
        run.state(FAILS, Queued);
        clock += 1500;
        await explorer.waitFrame((text) => /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 0\/2 1\.5s/.test(text));
        expect(explorer.lines().find((line) => line.includes(" adds"))).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] adds/);
        expect(explorer.lines().find((line) => line.includes(" fails"))).toContain("◷ fails");
        // The parents show the highest priority: Running.
        expect(explorer.lines().find((line) => line.includes(" math "))).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] math/);
        // No rerun while it runs.
        expect(explorer.lines()[2]).not.toContain("↻");
        run.state(ADDS, Passed, 12);
        run.state(FAILS, Failed, 3400);
        clock += 2000;
        run.end();
        await explorer.waitFrame((text) => text.includes("✗ 1/2 3.5s"));
        expect(titleButtons(explorer)).toContain("▷");
        expect(explorer.views.contextKeys.get("testing.isRunning")).toBe(false);
        expect(explorer.lines()[2]).toMatch(/✗ 1\/2 3\.5s\s+↻/);
        const frame = explorer.frame();
        expect(frame).toContain("✓ adds 12ms");
        expect(frame).toContain("✗ fails 3.4s");
        // A suite's duration is its children's sum.
        expect(frame).toContain("✗ math 3.4s");
        expect(frame).toContain("○ slow");
        const red = THEME.getColor("testing.iconFailed");
        const green = THEME.getColor("testing.iconPassed");
        const at = (label: string) => explorer.locate(`${label} `);
        expect(explorer.fgAt(at("fails").x - 2, at("fails").y)).toBe(red);
        expect(explorer.fgAt(at("adds").x - 2, at("adds").y)).toBe(green);
        const summary = explorer.locate("✗ 1/2");
        expect(explorer.fgAt(summary.x, summary.y)).toBe(red);
    });

    it("Cancel Test Run in the title cancels the run's token and the extension host's run", async () => {
        const explorer = await withTests();
        void explorer.views.commands.execute("testing.runSelected");
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(1);
        });
        await vi.waitFor(() => {
            expect(titleButtons(explorer)).toContain("■");
        });
        const { x, y } = explorer.locate("■");
        explorer.click(x, y);
        await vi.waitFor(() => {
            expect(explorer.runs[0].token.isCancellationRequested).toBe(true);
        });
        expect(explorer.cancels).toEqual([explorer.runs[0].requests[0].runId]);
        explorer.runs[0].finish();
        await vi.waitFor(() => {
            expect(titleButtons(explorer)).toContain("▷");
        });
    });

    it("a runHandler's error is a toast and the run ends", async () => {
        const explorer = await withTests();
        void explorer.views.commands.execute("testing.runSelected");
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(1);
        });
        explorer.runs[0].finish([{ error: "Error: no vitest" }]);
        await vi.waitFor(() => {
            expect(explorer.errors).toEqual(["An error occurred attempting to run tests: Error: no vitest"]);
        });
        await explorer.waitFrame((text) => text.includes("○ 0/0"));
    });

    it("under a filter Run Tests runs what it matched, without what it hides", async () => {
        const explorer = await withTests();
        explorer.component.filterInput.focus();
        for (const char of "!slow") explorer.sendKey(char);
        await explorer.waitFrame((text) => !text.includes(" slow"));
        void explorer.views.commands.execute("testing.runSelected");
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(1);
        });
        // `!slow` alone: every other test matches, the topmost of them run.
        expect(explorer.runs[0].requests[0]).toMatchObject({
            testIds: ["vitest"],
            excludeExtIds: [testId(...SLOW)],
        });
    });
});

describe("Test Explorer — a test's own run", () => {
    it("the row's ▷ runs its test; its context menu has Run Test too", async () => {
        const explorer = await withTests();
        const { y } = explorer.row("fails");
        explorer.mouse(5, y, "move", "none");
        await explorer.waitFrame((text) => (text.split("\n")[y] ?? "").includes("▷"));
        const line = explorer.lines()[y];
        explorer.click(line.lastIndexOf("▷"), y);
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(1);
        });
        expect(explorer.runs[0].requests[0].testIds).toEqual([testId(...FAILS)]);
        explorer.runs[0].finish();
        // Run before Go to Test in the menu.
        explorer.sendKey("Shift+F10");
        expect(menuLabels(explorer)).toEqual(["Run Test", "Go to Test"]);
    });

    it("the keyboard runs the test under the cursor; a gone test runs nothing", async () => {
        const explorer = await withTests();
        const { x, y } = explorer.row("adds");
        explorer.click(x, y);
        void explorer.views.commands.execute("testing.run");
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(1);
        });
        expect(explorer.runs[0].requests[0].testIds).toEqual([testId(...ADDS)]);
        void explorer.views.commands.execute("testing.run", { $testId: "vitest\0gone" });
        expect(explorer.results.results).toHaveLength(1);
    });
});

describe("Test Explorer — results", () => {
    it("Rerun Last Run (the summary's ↻) runs the same targets again", async () => {
        const explorer = await withTests();
        await runAndFail(explorer);
        await explorer.waitFrame((text) => text.includes("↻"));
        const { x, y } = explorer.locate("↻");
        explorer.click(x, y);
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(2);
        });
        expect(explorer.runs[1].requests[0].testIds).toEqual(["vitest"]);
    });

    it("Rerun Failed Tests runs only the failed one; a new state of other tests keeps the old ones", async () => {
        const explorer = await withTests();
        await runAndFail(explorer);
        void explorer.views.commands.execute("testing.reRunFailTests");
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(2);
        });
        expect(explorer.runs[1].requests[0].testIds).toEqual([testId(...FAILS)]);
        const second = report(explorer, 1);
        second.state(FAILS, Passed, 1);
        second.end();
        // `adds` keeps its state from the first run.
        await explorer.waitFrame((text) => text.includes("✓ fails 1.0ms") && text.includes("✓ adds 12ms"));
        expect(explorer.lines()[2]).toContain("✓ 1/1");
        // Nothing failed any more: nothing to rerun.
        void explorer.views.commands.execute("testing.reRunFailTests");
        expect(explorer.runs).toHaveLength(2);
    });

    it("Rerun Failed Tests from Last Run looks at the latest run only", async () => {
        const explorer = await withTests();
        await runAndFail(explorer);
        void explorer.views.commands.execute("testing.run", { $testId: testId(...ADDS) });
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(2);
        });
        const second = report(explorer, 1);
        second.state(ADDS, Passed);
        second.end();
        await vi.waitFor(() => {
            expect(second.result.completedAt).toBeDefined();
        });
        void explorer.views.commands.execute("testing.reRunFailedFromLastRun");
        expect(explorer.runs).toHaveLength(2);
        void explorer.views.commands.execute("testing.reRunFailTests");
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(3);
        });
        expect(explorer.runs[2].requests[0].testIds).toEqual([testId(...FAILS)]);
    });

    it("without results the reruns are unavailable; Clear All Results brings the states back to unset", async () => {
        const explorer = await withTests();
        void explorer.views.commands.execute("testing.reRunLastRun");
        void explorer.views.commands.execute("testing.reRunFailTests");
        void explorer.views.commands.execute("testing.reRunFailedFromLastRun");
        expect(explorer.runs).toHaveLength(0);
        await runAndFail(explorer);
        await explorer.waitFrame((text) => text.includes("✗ fails"));
        void explorer.views.commands.execute("testing.clearTestResults");
        await explorer.waitFrame((text) => text.includes("No test results yet.") && text.includes("○ fails"));
        expect(explorer.frame()).not.toContain("3.0ms");
        expect(explorer.frame()).not.toContain("↻");
        expect(explorer.views.contextKeys.get("testing.hasAnyResults")).toBe(false);
    });

    it("Rerun Last Run without the run's profile falls back to the defaults", async () => {
        const explorer = await withTests();
        await runAndFail(explorer);
        explorer.profiles.removeProfile("vitest", 1);
        explorer.profiles.addProfile({
            controllerId: "vitest",
            profileId: 2,
            label: "Again",
            group: TestRunProfileBitset.Run,
            isDefault: true,
            tag: null,
            hasConfigurationHandler: false,
            supportsContinuousRun: false,
        });
        void explorer.views.commands.execute("testing.reRunLastRun");
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(2);
        });
        expect(explorer.runs[1].requests[0]).toMatchObject({ profileId: 2, testIds: ["vitest"] });
    });

    it("after a run the failed test's collapsed ancestors expand", async () => {
        const explorer = await withTests();
        const { x, y } = explorer.row("math.test.ts");
        explorer.click(x, y);
        await explorer.waitFrame((text) => !text.includes(" adds"));
        await runAndFail(explorer);
        await explorer.waitFrame((text) => text.includes("✗ fails"));
    });

    it("cancelled and unfinished tests are skipped, as upstream's markTaskComplete", async () => {
        const explorer = await withTests();
        void explorer.views.commands.execute("testing.runSelected");
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(1);
        });
        const run = report(explorer);
        run.state(ADDS, Running);
        run.state(FAILS, Queued);
        run.state(SLOW, Errored, 5);
        run.end();
        await explorer.waitFrame(
            (text) => text.includes("↷ adds") && text.includes("↷ fails") && text.includes("⊙ slow 5.0ms"),
        );
        expect(explorer.lines()[2]).toContain("⊙ 0/1");
        void Skipped;
    });

    it("a run the extension started is in the tree and the summary like one of the core's", async () => {
        const explorer = await withTests();
        explorer.adapter.startedExtensionTestRun({
            runId: "ext",
            controllerId: "vitest",
            include: [testId(...ADDS)],
            exclude: [],
            profileId: 1,
            preserveFocus: true,
            persist: true,
            continuous: false,
        });
        explorer.adapter.startedTestRunTask({ runId: "ext", taskId: "t", controllerId: "vitest", name: "vitest" });
        explorer.adapter.addTestsToRun({
            runId: "ext",
            controllerId: "vitest",
            tests: [wireItem(ROOT), wireItem(FILE), wireItem(SUITE), wireItem(ADDS)],
        });
        explorer.adapter.updateTestStateInRun({ runId: "ext", taskId: "t", testId: testId(...ADDS), state: Running });
        await explorer.waitFrame((text) => text.includes("■") && /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] adds/.test(text));
        explorer.adapter.updateTestStateInRun({
            runId: "ext",
            taskId: "t",
            testId: testId(...ADDS),
            state: Passed,
            duration: 2,
        });
        explorer.adapter.finishedExtensionTestRun("ext");
        await explorer.waitFrame((text) => text.includes("✓ adds 2.0ms") && text.includes("✓ 1/1"));
    });
});

describe("Test Explorer — the summary", () => {
    it(`a run in progress is redrawn every ${String(SUMMARY_RENDER_INTERVAL)} ms, not on each report`, async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        try {
            let clock = 0;
            const explorer = setupExplorer({ now: () => clock });
            explorer.registerController("vitest");
            explorer.tests.publishDiff([add(wireItem(ROOT), Expanded), add(wireItem(["vitest", "a"]), NotExpandable)]);
            const result = explorer.results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
            await vi.advanceTimersByTimeAsync(0);
            result.addTask({ id: "t", name: "t", ctrlId: "vitest" });
            result.addTestChainToRun("vitest", [wireItem(ROOT), wireItem(["vitest", "a"])]);
            clock = 100;
            result.updateState(testId("vitest", "a"), "t", Passed);
            expect(explorer.frame()).toContain(" 0/0 0.0ms");
            clock = 250;
            await vi.advanceTimersByTimeAsync(SUMMARY_RENDER_INTERVAL);
            expect(explorer.frame()).toContain(" 1/1 250ms");
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("Test Explorer — state filters and sortings", () => {
    it("`@failed` shows the failed tests and their parents; More Filters toggles it and Show Only Executed Tests", async () => {
        const explorer = await withTests();
        await runAndFail(explorer);
        await explorer.waitFrame((text) => text.includes("✗ fails"));
        const glyph = explorer.locate("▽");
        explorer.click(glyph.x, glyph.y);
        expect(menuLabels(explorer)).toEqual(["Show Only Failed Tests", "Show Only Executed Tests"]);
        expect(explorer.views.shown.at(-1)?.getOwner()).toBe(explorer.component.filterInput);
        selectMenu(explorer, "Show Only Failed Tests");
        await explorer.waitFrame(
            (text) => text.includes("@failed") && !text.includes(" adds") && text.includes(" fails"),
        );
        expect(explorer.component.isFilteringFor("@failed")).toBe(true);
        explorer.click(glyph.x, glyph.y);
        expect(menuIcons(explorer)).toEqual(["✓", undefined]);
        selectMenu(explorer, "Show Only Failed Tests");
        await explorer.waitFrame((text) => !text.includes("@failed") && text.includes(" adds"));
        explorer.component.toggleFilteringFor("@executed");
        await explorer.waitFrame(
            (text) => text.includes("@executed") && text.includes(" adds") && !text.includes(" slow"),
        );
    });

    it("Sort by Status puts the failed first, by Duration the longest first; the choice is kept in the workspace", async () => {
        const explorer = await withTests();
        await runAndFail(explorer);
        const order = (): string[] =>
            explorer
                .lines()
                .map((line) => /[✓✗○] (adds|fails|slow)\b/.exec(line)?.[1])
                .filter((label): label is string => label !== undefined);
        await vi.waitFor(() => {
            expect(order()).toEqual(["adds", "fails", "slow"]);
        });
        expect(explorer.component.viewSorting).toBe("location");
        void explorer.views.commands.execute("testing.sortByStatus");
        await vi.waitFor(() => {
            expect(order()).toEqual(["fails", "adds", "slow"]);
        });
        expect(explorer.views.contextKeys.get("testing.explorerViewSorting")).toBe("status");
        expect(explorer.views.stored.get(TESTING_VIEW_SORTING_STATE.key)).toBe("status");
        void explorer.views.commands.execute("testing.sortByDuration");
        await vi.waitFor(() => {
            expect(order()).toEqual(["adds", "fails", "slow"]);
        });
        void explorer.views.commands.execute("testing.sortByLocation");
        expect(explorer.component.viewSorting).toBe("location");
        // Another workspace has its own.
        explorer.views.stored.set(TESTING_VIEW_SORTING_STATE.key, "duration");
        explorer.views.openWorkspace();
        expect(explorer.component.viewSorting).toBe("duration");
    });

    it("the sortings are in ⋯ with the current one checked, next to Clear All Results and Collapse All", async () => {
        const explorer = await withTests();
        const { x, y } = explorer.locate("⋯");
        explorer.click(x, y);
        // Equal orders go by title, as upstream's menu.
        expect(menuLabels(explorer).slice(0, 6)).toEqual([
            "Collapse All Tests",
            "Clear All Results",
            "-",
            "Sort by Duration",
            "Sort by Location",
            "Sort by Status",
        ]);
        expect(menuIcons(explorer).slice(3, 6)).toEqual([undefined, "✓", undefined]);
    });
});

describe("Test Explorer — following the running test", () => {
    it("testing.followRunningTest moves the cursor to the test that starts; a failed one expands its ancestors", async () => {
        const explorer = await withTests({ settings: { "testing.followRunningTest": true } });
        const file = explorer.row("math.test.ts");
        explorer.click(file.x, file.y);
        await explorer.waitFrame((text) => !text.includes(" adds"));
        void explorer.views.commands.execute("testing.runSelected");
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(1);
        });
        const run = report(explorer);
        run.state(ADDS, Running);
        // Collapsed: the cursor stops at the nearest shown ancestor.
        await vi.waitFor(() => {
            expect(explorer.component.focusedTestId).toBe(testId(...FILE));
        });
        run.state(FAILS, Failed);
        await vi.waitFor(() => {
            expect(explorer.component.focusedTestId).toBe(testId(...FAILS));
        });
        await explorer.waitFrame((text) => text.includes("✗ fails"));
    });

    it("testing.alwaysRevealTestOnStateChange expands to a passing test too; without followRunningTest nothing moves", async () => {
        const explorer = await withTests({
            settings: { "testing.followRunningTest": true, "testing.alwaysRevealTestOnStateChange": true },
        });
        const file = explorer.row("math.test.ts");
        explorer.click(file.x, file.y);
        void explorer.views.commands.execute("testing.runSelected");
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(1);
        });
        report(explorer).state(ADDS, Passed);
        await vi.waitFor(() => {
            expect(explorer.component.focusedTestId).toBe(testId(...ADDS));
        });
        explorer.setSetting("testing.followRunningTest", false);
        report(explorer).state(SLOW, Running);
        await Promise.resolve();
        expect(explorer.component.focusedTestId).toBe(testId(...ADDS));
    });
});

describe("Test Explorer — commands with arguments", () => {
    it("Cancel Test Run with a run and a task cancels that task only; the reruns take a run's id", async () => {
        const explorer = await withTests();
        await runAndFail(explorer);
        const firstId = explorer.runs[0].requests[0].runId;
        void explorer.views.commands.execute("testing.run", { $testId: testId(...ADDS) });
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(2);
        });
        const second = report(explorer, 1);
        void explorer.views.commands.execute("testing.cancelRun", second.result.id, "t");
        expect(explorer.cancels).toEqual([`${second.result.id}/t`]);
        expect(explorer.runs[1].token.isCancellationRequested).toBe(false);
        second.state(ADDS, Passed);
        second.end();
        await vi.waitFor(() => {
            expect(second.result.completedAt).toBeDefined();
        });
        // The first run by its id: all of it again, then its failed one.
        void explorer.views.commands.execute("testing.reRunLastRun", firstId);
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(3);
        });
        expect(explorer.runs[2].requests[0].testIds).toEqual(["vitest"]);
        explorer.runs[2].finish();
        void explorer.views.commands.execute("testing.reRunFailedFromLastRun", firstId);
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(4);
        });
        expect(explorer.runs[3].requests[0].testIds).toEqual([testId(...FAILS)]);
        void explorer.views.commands.execute("testing.reRunLastRun", "gone");
        void explorer.views.commands.execute("testing.reRunFailedFromLastRun", "gone");
        expect(explorer.runs).toHaveLength(4);
    });

    it("Run Test under a filter leaves out the descendants it hides", async () => {
        const explorer = await withTests();
        explorer.component.filterInput.focus();
        for (const char of "!slow") explorer.sendKey(char);
        await explorer.waitFrame((text) => !text.includes(" slow"));
        void explorer.views.commands.execute("testing.run", { $testId: testId(...SUITE) });
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(1);
        });
        expect(explorer.runs[0].requests[0]).toMatchObject({
            testIds: [testId(...SUITE)],
            excludeExtIds: [testId(...SLOW)],
        });
    });

    it("More Filters opens under the glyph", async () => {
        const explorer = await withTests();
        const glyph = explorer.locate("▽");
        explorer.click(glyph.x, glyph.y);
        expect(explorer.views.shown.at(-1)?.getAnchor()).toEqual({ screenX: glyph.x, screenY: glyph.y + 1 });
    });
});

describe("Test Explorer — edges of the commands", () => {
    it("Run Test on an empty tree runs nothing; Rerun Failed skips a failed test gone from the tree", async () => {
        const empty = setupExplorer();
        empty.registerController("vitest");
        empty.profiles.addProfile({
            controllerId: "vitest",
            profileId: 1,
            label: "Run",
            group: TestRunProfileBitset.Run,
            isDefault: true,
            tag: null,
            hasConfigurationHandler: false,
            supportsContinuousRun: false,
        });
        void empty.views.commands.execute("testing.run");
        expect(empty.results.results).toHaveLength(0);
        const explorer = await withTests();
        await runAndFail(explorer);
        explorer.tests.publishDiff([{ op: 3, itemId: testId(...FAILS) }]);
        void explorer.views.commands.execute("testing.reRunFailTests");
        expect(explorer.results.results).toHaveLength(1);
    });

    it("Run All Tests runs a root that may have tests: expandable or resolving", async () => {
        for (const expand of [Expandable, TestItemExpandState.BusyExpanding]) {
            const explorer = setupExplorer();
            explorer.registerController("vitest");
            explorer.profiles.addProfile({
                controllerId: "vitest",
                profileId: 1,
                label: "Run",
                group: TestRunProfileBitset.Run,
                isDefault: true,
                tag: null,
                hasConfigurationHandler: false,
                supportsContinuousRun: false,
            });
            explorer.tests.publishDiff([add(wireItem(ROOT), expand)]);
            void explorer.views.commands.execute("testing.runAll");
            await vi.waitFor(() => {
                expect(explorer.runs).toHaveLength(1);
            });
        }
    });
});

describe("Test Explorer — the details of states, sorting and following", () => {
    it("a description with a duration is `description: duration`; a suite with its own duration shows that one", async () => {
        const explorer = await withTests();
        explorer.tests.publishDiff([update(ADDS, { description: "fast" })]);
        void explorer.views.commands.execute("testing.runSelected");
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(1);
        });
        const run = report(explorer);
        run.state(ADDS, Passed, 12);
        run.state(SUITE, Passed, 99);
        run.end();
        await explorer.waitFrame((text) => text.includes("adds fast: 12ms") && text.includes("math 99ms"));
    });

    it("tests on the same line keep the extension's order unless a sortText says otherwise; a sorting chosen again changes nothing", async () => {
        const explorer = setupExplorer();
        explorer.registerController("vitest");
        const sameLine = (name: string, sortText: string | null = null) =>
            add(
                wireItem(["vitest", name], name, { uri: URI, range: createRange(1, 0, 1, 1), sortText }),
                NotExpandable,
            );
        explorer.tests.publishDiff([
            add(wireItem(ROOT), Expanded),
            sameLine("zeta"),
            sameLine("alpha"),
            sameLine("beta", "0"),
        ]);
        await explorer.waitFrame((text) => text.includes(" alpha"));
        const rows = explorer
            .lines()
            .map((line) => /○ (\w+)/.exec(line)?.[1])
            .filter((name) => name !== undefined);
        expect(rows).toEqual(["beta", "zeta", "alpha"]);
        explorer.views.stored.clear();
        void explorer.views.commands.execute("testing.sortByLocation");
        expect(explorer.views.stored.has(TESTING_VIEW_SORTING_STATE.key)).toBe(false);
    });

    it("under a filter matching one test, the hidden siblings are not excluded: they are not under it", async () => {
        const explorer = await withTests();
        explorer.component.filterInput.focus();
        for (const char of "adds") explorer.sendKey(char);
        await explorer.waitFrame((text) => !text.includes(" slow"));
        void explorer.views.commands.execute("testing.runSelected");
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(1);
        });
        expect(explorer.runs[0].requests[0]).toMatchObject({ testIds: [testId(...ADDS)], excludeExtIds: [] });
    });

    it("following: a queued test does not move the cursor; a test or ancestors gone from the tree are skipped", async () => {
        const explorer = await withTests({ settings: { "testing.followRunningTest": true } });
        const { x, y } = explorer.row("slow");
        explorer.click(x, y);
        void explorer.views.commands.execute("testing.runSelected");
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(1);
        });
        const run = report(explorer);
        run.state(ADDS, Queued);
        await Promise.resolve();
        expect(explorer.component.focusedTestId).toBe(testId(...SLOW));
        // The only controller's root itself: there is no row to go to.
        run.state(ROOT, Running);
        // A test the tree no longer has: its known ancestors are the way, and it fails — they expand.
        run.state([...SUITE, "gone"], Failed);
        await vi.waitFor(() => {
            expect(explorer.component.focusedTestId).toBe(testId(...SUITE));
        });
        explorer.tests.publishDiff([{ op: 3, itemId: testId(...FILE) }]);
        run.end();
        await vi.waitFor(() => {
            expect(run.result.completedAt).toBeDefined();
        });
    });
});

describe("Test Explorer — following with everything shown", () => {
    it("an expanded tree: the cursor goes to the test itself; with two controllers the controller rows are on the way", async () => {
        const explorer = await withTests({ settings: { "testing.followRunningTest": true } });
        void explorer.views.commands.execute("testing.runSelected");
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(1);
        });
        report(explorer).state(SLOW, Running);
        await vi.waitFor(() => {
            expect(explorer.component.focusedTestId).toBe(testId(...SLOW));
        });
        explorer.registerController("other");
        explorer.tests.publishDiff([add(wireItem(["other"]), Expanded), add(wireItem(["other", "x"]), NotExpandable)]);
        await explorer.waitFrame((text) => text.includes(" other"));
        report(explorer).state(ADDS, Running);
        await vi.waitFor(() => {
            expect(explorer.component.focusedTestId).toBe(testId(...ROOT));
        });
    });
});

describe("Test Explorer — Run All Tests", () => {
    it("Ctrl+; A runs every controller that may have tests; none — a hint to install a test extension", async () => {
        const empty = setupExplorer();
        void empty.views.commands.execute("testing.runAll");
        expect(empty.toasts).toEqual([
            "No tests found in this workspace. You may need to install a test provider extension",
        ]);
        const explorer = await withTests();
        void explorer.views.commands.execute("testing.runAll");
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(1);
        });
        expect(explorer.runs[0].requests[0].testIds).toEqual(["vitest"]);
        void update;
        void Expandable;
    });
});
