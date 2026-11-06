import { describe, expect, it, vi } from "vitest";

import { add, setupExplorer, UNICODE_ICONS, wireItem } from "../../../../../TestUtils/testingExplorerHarness.ts";
import { testId } from "../../../../../TestUtils/testTree.ts";
import { codicon } from "../../../../base/common/codicons.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { TestItemExpandState, TestResultState, TestRunProfileBitset } from "../../../api/common/testingWireTypes.ts";
import type { LiveTestResult } from "../common/testResult.ts";

import { MIN_CONTENT_WIDTH, splitWidths } from "./testResultsSplitElement.ts";

// The TEST RESULTS tree's rows: their glyphs and menus, Enter on a test, the older runs.

const { Running, Passed, Failed } = TestResultState;
const SUITE = ["vitest", "math.test.ts", "math"];
const ADDS = [...SUITE, "adds"];
const FAILS = [...SUITE, "fails"];
const TREE_X = 50;

const glyph = (name: string): string => UNICODE_ICONS.glyph(codicon(name));

function setup() {
    const harness = setupExplorer({ panelWidth: 100, panelHeight: 12 });
    const executed = vi.spyOn(harness.views.commands, "execute");
    return { harness, executed };
}

type Harness = ReturnType<typeof setup>["harness"];

function start(harness: Harness): LiveTestResult {
    const result = harness.results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
    result.addTask({ id: "t", name: "vitest", ctrlId: "vitest" });
    return result;
}

function report(result: LiveTestResult, path: readonly string[], state: TestResultState): void {
    const uri = "file:///w/math.test.ts";
    const range = createRange(2, 0, 2, 4);
    result.addTestChainToRun(
        "vitest",
        path.map((_, i) => wireItem(path.slice(0, i + 1), path[i], { uri, range })),
    );
    result.updateState(testId(...path), "t", state);
}

function failed(harness: Harness): LiveTestResult {
    const result = start(harness);
    report(result, ADDS, Passed);
    report(result, FAILS, Failed);
    result.appendOutput("fails out\r\n", "t", undefined, testId(...FAILS));
    result.appendMessage(testId(...FAILS), "t", { message: "expected 2 to be 3\none\ntwo" });
    result.markComplete();
    return result;
}

/** The tree's half of the row showing `text`. */
function treeRow(harness: Harness, text: string): { y: number; line: string } {
    const lines = harness.panel.lines();
    const y = lines.findIndex((line) => line.slice(TREE_X).includes(text));
    expect(y, `"${text}" in the tree:\n${lines.join("\n")}`).toBeGreaterThanOrEqual(0);
    return { y, line: lines[y].slice(TREE_X) };
}

/** Clicks the row's glyph. */
function clickGlyph(harness: Harness, row: { y: number; line: string }, name: string): void {
    const x = row.line.lastIndexOf(glyph(name));
    expect(x, `${name} on "${row.line}"`).toBeGreaterThanOrEqual(0);
    harness.panel.click(TREE_X + x, row.y);
}

function menuLabels(harness: Harness): string[] {
    const entries = harness.views.shown.at(-1)?.getEntries?.() ?? [];
    return entries.map((entry) => (entry.type === "separator" ? "-" : entry.label));
}

describe("TEST RESULTS — the rows' actions", () => {
    it("a running task spins and offers Cancel Test Run for itself", async () => {
        const { harness, executed } = setup();
        const result = start(harness);
        report(result, ADDS, Running);
        await harness.panel.waitFrame((text) => text.includes("vitest"));
        const row = treeRow(harness, "vitest");
        expect(row.line).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] vitest/);
        expect(row.line).toContain(glyph("debug-stop"));
        clickGlyph(harness, row, "debug-stop");
        expect(executed).toHaveBeenCalledWith("testing.cancelRun", result.id, "t");
        result.markComplete();
    });

    it("a completed task: Show Result Output, Rerun Last Run, Rerun Failed Tests; its menu lists them", async () => {
        const { harness, executed } = setup();
        const result = failed(harness);
        await harness.panel.waitFrame((text) => text.includes("fails"));
        const row = treeRow(harness, "vitest");
        expect(row.line).not.toContain(glyph("debug-stop"));
        expect(row.line).toContain(`${glyph("terminal")} ${glyph("debug-rerun")} ${glyph("debug-rerun")}`);
        harness.panel.click(TREE_X + row.line.indexOf("vitest"), row.y, "right");
        expect(menuLabels(harness)).toEqual(["Show Result Output", "Rerun Last Run", "Rerun Failed Tests"]);
        const rerunX = row.line.lastIndexOf(glyph("debug-rerun"));
        harness.panel.click(TREE_X + rerunX, row.y);
        expect(executed).toHaveBeenCalledWith("testing.reRunFailedFromLastRun", result.id);
        harness.panel.click(TREE_X + rerunX - 2, row.y);
        expect(executed).toHaveBeenCalledWith("testing.reRunLastRun", result.id);
    });

    it("a test: Go to Test, Show Result Output, Run Test while there is a runnable test; Reveal in Test Explorer in its menu", async () => {
        const { harness, executed } = setup();
        harness.views.contextKeys.set("testing.hasRunnableTests", true);
        failed(harness);
        await harness.panel.waitFrame((text) => text.includes("fails"));
        const row = treeRow(harness, "fails");
        harness.panel.click(TREE_X + row.line.indexOf("fails"), row.y, "right");
        expect(menuLabels(harness)).toEqual([
            "Go to Test",
            "Show Result Output",
            "Run Test",
            "-",
            "Reveal in Test Explorer",
        ]);
        const entries = harness.views.shown.at(-1)?.getEntries?.() ?? [];
        const reveal = entries.at(-1);
        if (reveal?.type === undefined || reveal.type === "item") reveal?.onSelect?.();
        expect(executed).toHaveBeenCalledWith("_revealTestInExplorer", testId(...FAILS));
        // `adds` has no output: no Show Result Output.
        const adds = treeRow(harness, "adds");
        harness.panel.click(TREE_X + adds.line.indexOf("adds"), adds.y, "right");
        expect(menuLabels(harness)).toEqual(["Go to Test", "Run Test", "-", "Reveal in Test Explorer"]);
    });

    it("Enter on a test goes to it; a click only shows its output", async () => {
        const { harness, executed } = setup();
        failed(harness);
        await harness.panel.waitFrame((text) => text.includes("adds"));
        const adds = treeRow(harness, "adds");
        harness.panel.click(TREE_X + adds.line.indexOf("adds"), adds.y);
        expect(executed).not.toHaveBeenCalledWith("testing.editFocusedTest", expect.anything());
        expect(harness.panel.component.currentSubject).toMatchObject({ kind: "test", testId: testId(...ADDS) });
        harness.panel.sendKey("Enter");
        expect(executed).toHaveBeenCalledWith("testing.editFocusedTest", { $testId: testId(...ADDS) });
    });

    it("a message's first line with the count of the others", async () => {
        const { harness } = setup();
        failed(harness);
        await harness.panel.waitFrame((text) => text.includes("expected 2 to be 3 + 2 more lines"));
    });
});

describe("TEST RESULTS — older runs", () => {
    it("the latest run's tasks are the roots; the others go under N older results, collapsed, each run collapsed", async () => {
        const { harness } = setup();
        failed(harness);
        failed(harness);
        await harness.panel.waitFrame((text) => text.includes("1 older result"));
        failed(harness);
        await harness.panel.waitFrame((text) => text.includes("2 older results"));
        const older = treeRow(harness, "2 older results");
        harness.panel.click(TREE_X + older.line.indexOf("2 older"), older.y);
        const frame = await harness.panel.waitFrame((text) => text.includes("Test run at"));
        expect(frame.split("\n").filter((line) => line.includes("Test run at"))).toHaveLength(2);
        // The runs themselves stay collapsed: only one task row, the latest run's.
        expect(frame.split("\n").filter((line) => line.slice(TREE_X).includes(" vitest"))).toHaveLength(1);
    });
});

describe("TEST RESULTS — Reveal in Test Explorer", () => {
    it("opens the Test Explorer with the cursor on the test", async () => {
        const harness = setupExplorer({ height: 14 });
        harness.registerController("vitest", "Vitest");
        const { Expanded, NotExpandable } = TestItemExpandState;
        harness.tests.publishDiff([
            add(wireItem(["vitest"], "Vitest"), Expanded),
            add(wireItem(["vitest", "math.test.ts"]), Expanded),
            add(wireItem(SUITE), Expanded),
            add(wireItem(ADDS), NotExpandable),
            add(wireItem(FAILS), NotExpandable),
        ]);
        await harness.waitFrame((text) => text.includes(" math.test.ts"));
        const opened = vi.spyOn(harness.views.service, "openView");
        await harness.views.commands.execute("_revealTestInExplorer", testId(...FAILS));
        expect(opened).toHaveBeenCalledWith("workbench.view.testing", false);
        await vi.waitFor(() => {
            expect(harness.component.focusedTestId).toBe(testId(...FAILS));
        });
        await harness.waitFrame((text) => text.includes(" fails"));
    });
});

describe("TEST RESULTS — the split", () => {
    it("halves; the content keeps its minimum, the tree gives way first", () => {
        expect(splitWidths(100)).toEqual({ content: 50, tree: 50 });
        expect(splitWidths(51)).toEqual({ content: 26, tree: 25 });
        expect(splitWidths(40)).toEqual({ content: MIN_CONTENT_WIDTH, tree: 15 });
        expect(splitWidths(30)).toEqual({ content: MIN_CONTENT_WIDTH, tree: 5 });
        expect(splitWidths(20)).toEqual({ content: 20, tree: 0 });
    });
});
