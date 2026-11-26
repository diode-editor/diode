import { describe, expect, it, vi } from "vitest";

import {
    add,
    setupExplorer,
    testProfile,
    UNICODE_ICONS,
    wireItem,
} from "../../../../../TestUtils/testingExplorerHarness.ts";
import { testId } from "../../../../../TestUtils/testTree.ts";
import { codicon } from "../../../../base/common/codicons.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { TestItemExpandState, TestResultState, TestRunProfileBitset } from "../../../api/common/testingWireTypes.ts";
import type { LiveTestResult } from "../common/testResult.ts";

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

    it("a completed task: Show Result Output, Rerun Last Run, Rerun Failed Tests, Debug Last Run, Debug Failed Tests", async () => {
        const { harness, executed } = setup();
        const result = failed(harness);
        await harness.panel.waitFrame((text) => text.includes("fails"));
        const row = treeRow(harness, "vitest");
        expect(row.line).not.toContain(glyph("debug-stop"));
        const debug = glyph("debug-alt-small");
        expect(row.line).toContain(
            `${glyph("terminal")} ${glyph("debug-rerun")} ${glyph("debug-rerun")} ${debug} ${debug}`,
        );
        harness.panel.click(TREE_X + row.line.indexOf("vitest"), row.y, "right");
        expect(menuLabels(harness)).toEqual([
            "Show Result Output",
            "Rerun Last Run",
            "Rerun Failed Tests",
            "Debug Last Run",
            "Debug Failed Tests",
        ]);
        const menu = harness.views.shown.at(-1);
        expect(menu?.getOwner()).toBe(harness.panel.component.tree);
        expect(menu?.getAnchor()).toEqual({ screenX: TREE_X + row.line.indexOf("vitest"), screenY: row.y });
        const rerunX = row.line.lastIndexOf(glyph("debug-rerun"));
        harness.panel.click(TREE_X + rerunX, row.y);
        expect(executed).toHaveBeenCalledWith("testing.reRunFailedFromLastRun", result.id);
        harness.panel.click(TREE_X + rerunX - 2, row.y);
        expect(executed).toHaveBeenCalledWith("testing.reRunLastRun", result.id);
        const debugX = row.line.lastIndexOf(debug);
        harness.panel.click(TREE_X + debugX, row.y);
        expect(executed).toHaveBeenCalledWith("testing.debugFailedFromLastRun", result.id);
        harness.panel.click(TREE_X + debugX - 2, row.y);
        expect(executed).toHaveBeenCalledWith("testing.debugLastRun", result.id);
    });

    it("a completed task without failures: Debug Last Run, no Debug Failed Tests", async () => {
        const { harness } = setup();
        const result = start(harness);
        report(result, ADDS, Passed);
        result.markComplete();
        await harness.panel.waitFrame((text) => text.includes("adds"));
        const row = treeRow(harness, "vitest");
        harness.panel.click(TREE_X + row.line.indexOf("vitest"), row.y, "right");
        expect(menuLabels(harness)).toEqual(["Show Result Output", "Rerun Last Run", "Debug Last Run"]);
    });

    it("a test: Go to Test, Show Result Output, Run Test and Debug Test by its profiles; Reveal in Test Explorer in its menu", async () => {
        const { harness, executed } = setup();
        harness.profiles.addProfile(testProfile(TestRunProfileBitset.Run));
        harness.profiles.addProfile(testProfile(TestRunProfileBitset.Debug));
        failed(harness);
        await harness.panel.waitFrame((text) => text.includes("fails"));
        const row = treeRow(harness, "fails");
        harness.panel.click(TREE_X + row.line.indexOf("fails"), row.y, "right");
        expect(menuLabels(harness)).toEqual([
            "Go to Test",
            "Show Result Output",
            "Run Test",
            "Debug Test",
            "-",
            "Reveal in Test Explorer",
        ]);
        harness.panel.click(TREE_X + row.line.indexOf("fails"), row.y);
        clickGlyph(harness, treeRow(harness, "fails"), "debug-alt-small");
        expect(executed).toHaveBeenCalledWith("testing.debug", { $testId: testId(...FAILS) });
        const entries = harness.views.shown.at(-1)?.getEntries?.() ?? [];
        const reveal = entries.at(-1);
        if (reveal?.type === undefined || reveal.type === "item") reveal?.onSelect?.();
        expect(executed).toHaveBeenCalledWith("_revealTestInExplorer", testId(...FAILS));
        // `adds` has no output: no Show Result Output.
        const adds = treeRow(harness, "adds");
        harness.panel.click(TREE_X + adds.line.indexOf("adds"), adds.y, "right");
        expect(menuLabels(harness)).toEqual(["Go to Test", "Run Test", "Debug Test", "-", "Reveal in Test Explorer"]);
        // Only a Debug profile: no Run Test.
        harness.profiles.removeProfile("vitest", TestRunProfileBitset.Run);
        harness.panel.click(TREE_X + adds.line.indexOf("adds"), adds.y, "right");
        expect(menuLabels(harness)).toEqual(["Go to Test", "Debug Test", "-", "Reveal in Test Explorer"]);
    });

    it("Show Result Output on a test shows the test's own output", async () => {
        const { harness } = setup();
        failed(harness);
        await harness.panel.waitFrame((text) => text.includes("fails"));
        const fails = treeRow(harness, "fails");
        harness.panel.click(TREE_X + fails.line.indexOf("fails"), fails.y);
        clickGlyph(harness, treeRow(harness, "fails"), "terminal");
        expect(harness.panel.component.currentSubject).toMatchObject({
            kind: "test",
            test: { item: { extId: testId(...FAILS) } },
        });
        await harness.panel.waitFrame((text) => text.includes("fails out"));
    });

    it("a message has no rows under it", async () => {
        const { harness } = setup();
        const result = failed(harness);
        const frame = await harness.panel.waitFrame((text) => text.includes("+ 2 more lines"));
        await harness.panel.component.tree.expand({
            kind: "message",
            result,
            taskIndex: 0,
            test: result.getStateById(testId(...FAILS))!,
            messageIndex: 0,
        });
        expect(harness.panel.frame()).toBe(frame);
    });

    it("Enter on a test goes to it; a click only shows its output", async () => {
        const { harness, executed } = setup();
        failed(harness);
        await harness.panel.waitFrame((text) => text.includes("adds"));
        const adds = treeRow(harness, "adds");
        harness.panel.click(TREE_X + adds.line.indexOf("adds"), adds.y);
        expect(executed).not.toHaveBeenCalledWith("testing.editFocusedTest", expect.anything());
        expect(harness.panel.component.currentSubject).toMatchObject({
            kind: "test",
            test: { item: { extId: testId(...ADDS) } },
        });
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
        const taskRows = (text: string) => text.split("\n").filter((line) => line.slice(TREE_X).includes(" vitest"));
        expect(taskRows(frame)).toHaveLength(1);
        // "N older results" has no actions: no glyphs, no menu.
        const menus = harness.views.shown.length;
        harness.panel.click(TREE_X + older.line.indexOf("2 older"), older.y, "right");
        expect(harness.views.shown).toHaveLength(menus);
    });

    it("an older run expands to its tasks; its Show Result Output puts the cursor on its task", async () => {
        const { harness } = setup();
        const first = failed(harness);
        failed(harness);
        await harness.panel.waitFrame((text) => text.includes("1 older result"));
        const older = treeRow(harness, "1 older result");
        harness.panel.click(TREE_X + older.line.indexOf("1 older"), older.y);
        await harness.panel.waitFrame((text) => text.includes("Test run at"));
        const run = treeRow(harness, "Test run at");
        harness.panel.click(TREE_X + run.line.indexOf("Test run at"), run.y);
        expect(harness.panel.component.currentSubject).toMatchObject({ kind: "task", result: first, taskIndex: 0 });
        await harness.panel.waitFrame(
            (text) => text.split("\n").filter((line) => line.slice(TREE_X).includes(" vitest")).length === 2,
        );
        const { tree } = harness.panel.component;
        expect(tree.getSelectedNode()).toMatchObject({ kind: "result", result: first });
        clickGlyph(harness, treeRow(harness, "Test run at"), "terminal");
        await vi.waitFor(() => {
            expect(tree.getSelectedNode()).toMatchObject({ kind: "task", result: first, taskIndex: 0 });
        });
    });
});
