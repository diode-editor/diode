import { describe, expect, it, vi } from "vitest";

import {
    setupExplorer,
    SwitchableIcons,
    THEME,
    UNICODE_ICONS,
    wireItem,
} from "../../../../../TestUtils/testingExplorerHarness.ts";
import { createResultsPanel } from "../../../../../TestUtils/testResultsPanel.ts";
import { testId } from "../../../../../TestUtils/testTree.ts";
import { codicon } from "../../../../base/common/codicons.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { SPINNER_FRAMES } from "../../../../platform/progress/common/progressService.ts";
import { TestResultState, TestRunProfileBitset } from "../../../api/common/testingWireTypes.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import type { LiveTestResult } from "../common/testResult.ts";

import { TEST_RESULTS_CONTAINER_ID, TEST_RESULTS_VIEW_ID } from "./testResultsView.ts";

// The TEST RESULTS panel in detail: the rows' glyphs, what redraws them, the cursor, the menus, the settings.

const { Running, Passed, Failed } = TestResultState;
const SUITE = ["vitest", "math.test.ts", "math"];
const ADDS = [...SUITE, "adds"];
const FAILS = [...SUITE, "fails"];
const TREE_X = 50;
const FAST_PROGRESS = { delayMs: 0, intervalMs: 5, minVisibleMs: 0 };

const glyph = (name: string): string => UNICODE_ICONS.glyph(codicon(name));

type Options = Parameters<typeof setupExplorer>[0];

function setup(options: Options = {}) {
    const harness = setupExplorer({ panelWidth: 100, panelHeight: 14, ...options });
    const executed = vi.spyOn(harness.views.commands, "execute");
    return { harness, executed };
}

type Harness = ReturnType<typeof setup>["harness"];

function start(harness: Harness, tasks: readonly string[] = ["vitest"]): LiveTestResult {
    const result = harness.results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
    for (const name of tasks) result.addTask({ id: name, name, ctrlId: "vitest" });
    return result;
}

function report(
    result: LiveTestResult,
    path: readonly string[],
    state: TestResultState,
    options: { task?: string; uri?: boolean } = {},
): void {
    const fields = options.uri === false ? {} : { uri: "file:///w/math.test.ts", range: createRange(2, 0, 2, 4) };
    result.addTestChainToRun(
        "vitest",
        path.map((_, i) => wireItem(path.slice(0, i + 1), path[i], fields)),
    );
    result.updateState(testId(...path), options.task ?? "vitest", state);
}

/** `adds` passed, `fails` failed with a two-line message and its own output. */
function failed(harness: Harness): LiveTestResult {
    const result = start(harness);
    report(result, ADDS, Passed);
    report(result, FAILS, Failed);
    result.appendOutput("fails out\r\n", "vitest", undefined, testId(...FAILS));
    result.appendMessage(testId(...FAILS), "vitest", { message: "expected 2 to be 3\nat math.test.ts:3" });
    result.markComplete();
    return result;
}

function treeLines(harness: Harness): string[] {
    return harness.panel.lines().map((line) => line.slice(TREE_X));
}

/** The tree's half of the row showing `text`. */
function treeRow(harness: Harness, text: string): { y: number; line: string } {
    const lines = treeLines(harness);
    const y = lines.findIndex((line) => line.includes(text));
    expect(y, `"${text}" in the tree:\n${lines.join("\n")}`).toBeGreaterThanOrEqual(0);
    return { y, line: lines[y] };
}

function clickRow(harness: Harness, text: string, button: "left" | "middle" | "right" = "left"): void {
    const row = treeRow(harness, text);
    harness.panel.click(TREE_X + row.line.indexOf(text), row.y, button);
}

/** Opens the row's context menu and chooses `label`. */
function choose(harness: Harness, text: string, label: string): void {
    clickRow(harness, text, "right");
    const entry = (harness.views.shown.at(-1)?.getEntries?.() ?? []).find(
        (item) => item.type !== "separator" && item.label === label,
    );
    expect(entry, `${label} in the menu of "${text}"`).toBeDefined();
    if (entry?.type === undefined || entry.type === "item") entry?.onSelect?.();
}

function menuLabels(harness: Harness, text: string): string[] {
    clickRow(harness, text, "right");
    const entries = harness.views.shown.at(-1)?.getEntries?.() ?? [];
    return entries.map((entry) => (entry.type === "separator" ? "-" : entry.label));
}

/** The cursor up to the first task row. */
function toTask(harness: Harness): void {
    const { tree } = harness.panel.component;
    tree.focus();
    for (let i = 0; i < 20 && tree.getSelectedNode()?.kind !== "task"; i++) harness.panel.sendKey("ArrowUp");
}

const nextFrame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 40));

describe("TEST RESULTS — the frame", () => {
    it("its ids, the container's title and label, the view's title; it moves, it does not hide; focus goes to the tree", () => {
        const { harness } = setup();
        failed(harness);
        const { component } = harness.panel;
        expect(component.tree.id).toBe("testResultsTree");
        expect(component.view.id).toBe("testResultsView");
        const container = harness.views.service
            .getViewContainers()
            .find((entry) => entry.id === TEST_RESULTS_CONTAINER_ID);
        expect([container?.title, container?.label]).toEqual(["TEST RESULTS", "Test Results"]);
        const [view] = harness.views.service.getContainerViews(TEST_RESULTS_CONTAINER_ID);
        expect(view).toMatchObject({ id: TEST_RESULTS_VIEW_ID, title: "TEST RESULTS", canToggleVisibility: false });
        expect(harness.views.service.canMoveView(TEST_RESULTS_VIEW_ID)).toBe(true);
        harness.panel.frame();
        harness.views.service.openView(TEST_RESULTS_VIEW_ID, true);
        expect(component.tree.isFocused).toBe(true);
    });

    it("treeLeft from the start puts the tree on the left in the first frame; Toggle Tree Position writes treeRight back", async () => {
        const { harness } = setup({ settings: { "testing.resultsView.layout": "treeLeft" } });
        failed(harness);
        const frame = await harness.panel.waitFrame((text) => text.includes("fails out") || text.includes("vitest"));
        expect(frame.split("\n")[0].slice(0, TREE_X)).toContain("vitest");
        await harness.views.commands.execute("testing.toggleResultsViewLayout");
        expect(harness.configuration.get("testing.resultsView.layout")).toBe("treeRight");
    });

    it("a panel made while there are results has its tab", () => {
        const { harness } = setup();
        failed(harness);
        const views = makeViewsHarness([], UNICODE_ICONS);
        createResultsPanel({
            results: harness.results,
            views,
            theme: THEME,
            configuration: harness.configuration,
            progress: harness.progress,
        });
        expect(views.service.getViewContainerByViewId(TEST_RESULTS_VIEW_ID)).toBe(TEST_RESULTS_CONTAINER_ID);
    });
});

describe("TEST RESULTS — the rows", () => {
    it("state icons, twisties only on the rows with children, the message's one and more lines", async () => {
        const { harness } = setup();
        const result = start(harness);
        report(result, ADDS, Passed);
        // Output only: no rows under it.
        result.appendOutput("adds out\r\n", "vitest", undefined, testId(...ADDS));
        report(result, FAILS, Failed);
        result.appendMessage(testId(...FAILS), "vitest", { message: "expected 2 to be 3\nat math.test.ts:3" });
        report(result, [...SUITE, "trailing"], Failed);
        result.appendMessage(testId(...SUITE, "trailing"), "vitest", { message: "only this\n" });
        report(result, [...SUITE, "many"], Failed);
        result.appendMessage(testId(...SUITE, "many"), "vitest", { message: "first\nsecond\nthird" });
        result.markComplete();
        await harness.panel.waitFrame((text) => text.includes("+ 2 more lines"));
        expect(treeRow(harness, " vitest").line).toMatch(/^\s*▾ vitest/);
        expect(treeRow(harness, "adds").line).toMatch(new RegExp(`^\\s+${glyph("pass")} adds`));
        expect(treeRow(harness, "fails").line).toMatch(new RegExp(`▾ ${glyph("error")} fails`));
        expect(treeRow(harness, "expected 2 to be 3").line).toMatch(/^\s+expected 2 to be 3 \+ 1 more line\s*$/);
        expect(treeRow(harness, "only this").line).toMatch(/^\s+only this\s*$/);
        expect(treeRow(harness, "first").line).toMatch(/first \+ 2 more lines/);
        expect(treeRow(harness, "adds").line).not.toContain("▸");
    });

    it("a test directly under the controller has no description", async () => {
        const { harness } = setup();
        const result = start(harness);
        report(result, ["vitest", "top"], Passed);
        result.markComplete();
        await harness.panel.waitFrame((text) => text.includes("top"));
        expect(treeRow(harness, "top").line).toMatch(new RegExp(`${glyph("pass")} top\\s*$`));
    });

    it("a test that did not run but has a message is listed; one with neither is not", async () => {
        const { harness } = setup();
        const result = start(harness);
        report(result, ADDS, Passed);
        report(result, [...SUITE, "queued"], TestResultState.Unset);
        report(result, [...SUITE, "noted"], TestResultState.Unset);
        result.appendMessage(testId(...SUITE, "noted"), "vitest", { message: "a note" });
        result.markComplete();
        const frame = await harness.panel.waitFrame((text) => text.includes("noted"));
        expect(frame).not.toContain("queued");
    });

    it("older runs: exactly one or N older results; a completed one shows its state, a running one spins", async () => {
        const { harness } = setup();
        failed(harness);
        // The running runs come first: the earlier one is older than the latest. No test of it has reported yet.
        const running = start(harness);
        const one = await harness.panel.waitFrame((text) => text.includes("1 older result"));
        expect(one).not.toContain("1 older results");
        const latest = start(harness);
        await harness.panel.waitFrame((text) => text.includes("2 older results"));
        clickRow(harness, "2 older results");
        await harness.panel.waitFrame(
            (text) => text.split("\n").filter((line) => line.includes("Test run at")).length === 2,
        );
        const runs = treeLines(harness).filter((line) => line.includes("Test run at"));
        expect(runs[0]).toMatch(new RegExp(`[${SPINNER_FRAMES.join("")}] Test run at`));
        expect(runs[1]).toContain(`${glyph("error")} Test run at`);
        running.markComplete();
        latest.markComplete();
    });

    it("two older runs expand on their own; two messages of a test are two rows", async () => {
        const { harness } = setup();
        const first = start(harness);
        report(first, FAILS, Failed);
        result2Messages(first);
        first.markComplete();
        failed(harness);
        failed(harness);
        await harness.panel.waitFrame((text) => text.includes("2 older results"));
        clickRow(harness, "2 older results");
        await harness.panel.waitFrame(
            (text) => text.split("\n").filter((line) => line.includes("Test run at")).length === 2,
        );
        const older = treeLines(harness).findLastIndex((line) => line.includes("Test run at"));
        harness.panel.click(TREE_X + treeLines(harness)[older].indexOf("Test run at"), older);
        const frame = await harness.panel.waitFrame((text) => text.includes("second message"));
        expect(frame).toContain("first message");
        // Only the expanded run's task is there besides the latest run's one.
        expect(frame.split("\n").filter((line) => line.slice(TREE_X).includes(" vitest"))).toHaveLength(2);
    });
});

function result2Messages(result: LiveTestResult): void {
    result.appendMessage(testId(...FAILS), "vitest", { message: "first message" });
    result.appendMessage(testId(...FAILS), "vitest", { message: "second message" });
}

describe("TEST RESULTS — what redraws the tree", () => {
    const quiet = { settings: { "testing.automaticallyOpenTestResults": "neverOpen" } };

    it("a test's new state, a new task, the end of a task", async () => {
        const { harness } = setup(quiet);
        const result = start(harness);
        report(result, ADDS, Running);
        await harness.panel.waitFrame((text) => text.includes("adds"));
        result.updateState(testId(...ADDS), "vitest", Passed);
        await harness.panel.waitFrame((text) => text.includes(`${glyph("pass")} adds`));
        result.addTask({ id: "second", name: "second", ctrlId: "vitest" });
        await harness.panel.waitFrame((text) => text.includes(" second"));
        toTask(harness);
        await harness.panel.waitFrame((text) =>
            text.split("\n").some((line) => line.slice(TREE_X).includes(glyph("debug-stop"))),
        );
        result.markTaskComplete("vitest");
        await harness.panel.waitFrame((text) => !text.includes(glyph("debug-stop")));
        result.markComplete();
    });

    it("switching the icon set redraws the state icons", async () => {
        const icons = new SwitchableIcons();
        const { harness } = setup({ ...quiet, icons });
        failed(harness);
        await harness.panel.waitFrame((text) => text.includes("adds"));
        icons.useNerdFont();
        await harness.panel.waitFrame((text) => text.includes(`${icons.glyph(codicon("pass"))} adds`));
    });

    it("turning the indent guides on draws them", async () => {
        const { harness } = setup(quiet);
        failed(harness);
        const before = await harness.panel.waitFrame((text) => text.includes("adds"));
        expect(treeRow(harness, "adds").line).not.toContain("│");
        harness.setSetting("workbench.tree.renderIndentGuides", "always");
        await harness.panel.waitFrame((text) => text !== before && treeRow(harness, "adds").line.includes("│"));
    });

    it("the spinner ticks while the panel shows; a hidden panel and a finished run are not redrawn", async () => {
        const { harness } = setup({
            progress: FAST_PROGRESS,
            settings: { "testing.automaticallyOpenTestResults": "openOnTestStart" },
        });
        const result = start(harness);
        report(result, ADDS, Running);
        // Another run starts and ends while the first goes: the ticks are subscribed once.
        start(harness, ["other"]).markComplete();
        const spinning = (text: string): string | undefined =>
            SPINNER_FRAMES.find((spin) => text.split("\n").some((line) => line.includes(`${spin} adds`)));
        const first = spinning(await harness.panel.waitFrame((text) => spinning(text) !== undefined));
        await harness.panel.waitFrame((text) => spinning(text) !== undefined && spinning(text) !== first);
        result.markComplete();
        await nextFrame();
        const refresh = vi.spyOn(harness.panel.component.tree, "refresh");
        await harness.progress.withProgress({ location: "view", viewId: "other", title: "Other" }, nextFrame);
        await nextFrame();
        expect(refresh).not.toHaveBeenCalled();
    });

    it("a hidden panel is not redrawn by the ticks", async () => {
        const { harness } = setup({ ...quiet, progress: FAST_PROGRESS });
        const result = start(harness);
        report(result, ADDS, Running);
        await nextFrame();
        const refresh = vi.spyOn(harness.panel.component.tree, "refresh");
        await harness.progress.withProgress({ location: "view", viewId: "other", title: "Other" }, nextFrame);
        expect(refresh).not.toHaveBeenCalled();
        result.markComplete();
    });
});

describe("TEST RESULTS — the cursor and the content", () => {
    it("a collapsed row stays collapsed when the tree redraws", async () => {
        const { harness } = setup();
        const result = start(harness);
        report(result, FAILS, Failed);
        result.appendMessage(testId(...FAILS), "vitest", { message: "the message" });
        await harness.panel.waitFrame((text) => text.includes("the message"));
        clickRow(harness, "fails");
        await harness.panel.waitFrame((text) => !text.includes("the message"));
        report(result, ADDS, Passed);
        await harness.panel.waitFrame((text) => text.includes("adds"));
        await nextFrame();
        expect(harness.panel.frame()).not.toContain("the message");
        result.markComplete();
    });

    it("the cursor on a test's second message stays there when the tree redraws", async () => {
        const { harness } = setup();
        const result = start(harness);
        report(result, FAILS, Failed);
        result2Messages(result);
        await harness.panel.waitFrame((text) => text.includes("second message"));
        clickRow(harness, "second message");
        const { tree } = harness.panel.component;
        expect(tree.getSelectedNode()).toMatchObject({ kind: "message", messageIndex: 1 });
        report(result, ADDS, Passed);
        await harness.panel.waitFrame((text) => text.includes("adds"));
        expect(tree.getSelectedNode()).toMatchObject({ kind: "message", messageIndex: 1 });
        result.markComplete();
    });

    it("Enter on a task goes nowhere; a middle click on a test goes to it unless the open mode is doubleClick", async () => {
        const single = setup();
        failed(single.harness);
        await single.harness.panel.waitFrame((text) => text.includes("adds"));
        clickRow(single.harness, "adds", "middle");
        expect(single.executed).toHaveBeenCalledWith("testing.editFocusedTest", { $testId: testId(...ADDS) });
        single.executed.mockClear();
        toTask(single.harness);
        single.harness.panel.sendKey("Enter");
        expect(single.executed).not.toHaveBeenCalledWith("testing.editFocusedTest", expect.anything());

        const double = setup({ settings: { "workbench.list.openMode": "doubleClick" } });
        failed(double.harness);
        await double.harness.panel.waitFrame((text) => text.includes("adds"));
        clickRow(double.harness, "adds", "middle");
        expect(double.executed).not.toHaveBeenCalledWith("testing.editFocusedTest", expect.anything());
    });

    it("with expandMode doubleClick a click on a test only chooses it", async () => {
        const { harness } = setup({ settings: { "workbench.tree.expandMode": "doubleClick" } });
        failed(harness);
        await harness.panel.waitFrame((text) => text.includes("expected 2 to be 3"));
        clickRow(harness, "fails");
        await nextFrame();
        expect(harness.panel.frame()).toContain("expected 2 to be 3");
    });

    it("a new task of a run that is not the latest does not take the content; a second task does not move it", async () => {
        const { harness } = setup();
        const early = harness.results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
        const latest = start(harness);
        expect(harness.panel.component.currentSubject).toMatchObject({ result: latest, taskIndex: 0 });
        early.addTask({ id: "early", name: "early", ctrlId: "vitest" });
        latest.addTask({ id: "second", name: "second", ctrlId: "vitest" });
        expect(harness.panel.component.currentSubject).toMatchObject({ result: latest, taskIndex: 0 });
        report(latest, ADDS, Passed);
        await harness.panel.waitFrame((text) => text.includes("adds"));
        clickRow(harness, "adds");
        latest.addTask({ id: "third", name: "third", ctrlId: "vitest" });
        await harness.panel.waitFrame((text) => text.includes(" third"));
        expect(harness.panel.component.tree.getSelectedNode()).toMatchObject({ kind: "test" });
        early.markComplete();
        latest.markComplete();
    });

    it("Show Result Output on a task the user collapsed leaves it collapsed", async () => {
        const { harness } = setup();
        failed(harness);
        await harness.panel.waitFrame((text) => text.includes("adds"));
        clickRow(harness, " vitest");
        await harness.panel.waitFrame((text) => !text.includes("adds"));
        const task = treeRow(harness, " vitest");
        harness.panel.click(TREE_X + task.line.indexOf(glyph("terminal")), task.y);
        await nextFrame();
        expect(harness.panel.frame()).not.toContain("adds");
    });

    it("Show Output from a test: the latest run's first task, the keyboard in the panel", async () => {
        const { harness } = setup();
        const latest = failed(harness);
        await harness.panel.waitFrame((text) => text.includes("adds"));
        clickRow(harness, "adds");
        const opened = vi.spyOn(harness.views.service, "openView");
        await harness.views.commands.execute("testing.showMostRecentOutput");
        expect(opened).toHaveBeenCalledWith(TEST_RESULTS_VIEW_ID, true);
        expect(harness.panel.component.currentSubject).toMatchObject({ kind: "task", result: latest, taskIndex: 0 });
        await nextFrame();
        expect(harness.panel.component.tree.getSelectedNode()).toMatchObject({ kind: "task", result: latest });
    });

    it("Show Result Output from the menu: on a collapsed older run the cursor goes to its task, on a test to the test", async () => {
        const { harness } = setup();
        const first = failed(harness);
        failed(harness);
        await harness.panel.waitFrame((text) => text.includes("1 older result"));
        clickRow(harness, "1 older result");
        await harness.panel.waitFrame((text) => text.includes("Test run at"));
        choose(harness, "Test run at", "Show Result Output");
        const { tree } = harness.panel.component;
        // The right click has put the cursor on the run's row; the reveal moves it after the refresh.
        await nextFrame();
        expect(tree.getSelectedNode()).toMatchObject({ kind: "task", result: first, taskIndex: 0 });
        choose(harness, "fails", "Show Result Output");
        await nextFrame();
        expect(tree.getSelectedNode()).toMatchObject({ kind: "test", test: { item: { extId: testId(...FAILS) } } });
    });

    it("Clear All with a live run: its content and its collapsed rows stay", async () => {
        const { harness } = setup();
        failed(harness);
        const live = start(harness);
        report(live, FAILS, Failed);
        live.appendMessage(testId(...FAILS), "vitest", { message: "the message" });
        await harness.panel.waitFrame((text) => text.includes("the message"));
        clickRow(harness, "fails");
        await harness.panel.waitFrame((text) => !text.includes("the message"));
        const shown = harness.panel.component.currentSubject;
        await harness.views.commands.execute("testing.clearTestResults");
        expect(harness.panel.component.currentSubject).toBe(shown);
        report(live, ADDS, Passed);
        await harness.panel.waitFrame((text) => text.includes("adds") && !text.includes("older result"));
        await nextFrame();
        expect(harness.panel.frame()).not.toContain("the message");
        live.markComplete();
    });

    it("Clear All with one run: nothing is shown, the next run without tasks shows no old output", async () => {
        const { harness } = setup();
        const result = start(harness);
        result.appendOutput("old output\r\n", "vitest");
        result.markComplete();
        await harness.panel.waitFrame((text) => text.includes("old output"));
        await harness.views.commands.execute("testing.clearTestResults");
        expect(harness.panel.component.currentSubject).toBeNull();
        harness.results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run }).markComplete();
        await harness.panel.waitFrame((text) => text.includes("Test run at"));
        expect(harness.panel.frame()).not.toContain("old output");
    });
});

describe("TEST RESULTS — the menus", () => {
    it("a running task offers Cancel Test Run; an older run with one task Show Result Output, Rerun Test, Rerun Failed Tests", async () => {
        const { harness, executed } = setup();
        const result = start(harness);
        report(result, ADDS, Running);
        await harness.panel.waitFrame((text) => text.includes("adds"));
        expect(menuLabels(harness, " vitest")).toEqual(["Show Result Output", "Cancel Test Run"]);
        result.markComplete();
        const older = failed(harness);
        failed(harness);
        await harness.panel.waitFrame((text) => text.includes("2 older results"));
        clickRow(harness, "2 older results");
        await harness.panel.waitFrame((text) => text.includes("Test run at"));
        const runs = treeLines(harness)
            .map((line, y) => ({ line, y }))
            .filter(({ line }) => line.includes("Test run at"));
        harness.panel.click(TREE_X + runs[0].line.indexOf("Test run at"), runs[0].y, "right");
        const entries = harness.views.shown.at(-1)?.getEntries?.() ?? [];
        expect(entries.map((entry) => (entry.type === "separator" ? "-" : entry.label))).toEqual([
            "Show Result Output",
            "Rerun Test",
            "Rerun Failed Tests",
        ]);
        const rerun = entries[1];
        if (rerun.type === undefined || rerun.type === "item") rerun.onSelect?.();
        expect(executed).toHaveBeenCalledWith("testing.reRunLastRun", older.id);
    });

    it("an older run with two tasks has no Show Result Output", async () => {
        const { harness } = setup();
        const two = start(harness, ["a", "b"]);
        two.markComplete();
        failed(harness);
        await harness.panel.waitFrame((text) => text.includes("1 older result"));
        clickRow(harness, "1 older result");
        await harness.panel.waitFrame((text) => text.includes("Test run at"));
        expect(menuLabels(harness, "Test run at")).toEqual(["Rerun Test"]);
    });

    it("a test: Go to Test only with a location, Show Result Output only with output, Run Test only with runnable tests", async () => {
        const { harness, executed } = setup();
        const result = start(harness);
        report(result, FAILS, Failed);
        result.appendMessage(testId(...FAILS), "vitest", { message: "only an error" });
        report(result, [...SUITE, "nowhere"], Passed, { uri: false });
        result.markComplete();
        await harness.panel.waitFrame((text) => text.includes("nowhere"));
        expect(menuLabels(harness, "fails")).toEqual(["Go to Test", "-", "Reveal in Test Explorer"]);
        expect(menuLabels(harness, "nowhere")).toEqual(["Reveal in Test Explorer"]);
        harness.views.contextKeys.set("testing.hasRunnableTests", true);
        choose(harness, "fails", "Go to Test");
        expect(executed).toHaveBeenCalledWith("testing.editFocusedTest", { $testId: testId(...FAILS) });
        choose(harness, "fails", "Run Test");
        expect(executed).toHaveBeenCalledWith("testing.run", { $testId: testId(...FAILS) });
    });
});
