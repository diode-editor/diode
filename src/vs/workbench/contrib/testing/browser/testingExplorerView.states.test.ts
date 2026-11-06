import { describe, expect, it, vi } from "vitest";

import { add, setupExplorer, THEME, wireItem } from "../../../../../TestUtils/testingExplorerHarness.ts";
import { testId } from "../../../../../TestUtils/testTree.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import {
    type IWireTestItem,
    TestItemExpandState,
    TestResultState,
    TestRunProfileBitset,
} from "../../../api/common/testingWireTypes.ts";
import type { LiveTestResult } from "../common/testResult.ts";

// The computed states, sortings, the summary and following, each where the tree's order or shape tells them apart.

const { NotExpandable, Expandable, Expanded } = TestItemExpandState;
const { Running, Passed, Failed, Errored } = TestResultState;

const A_URI = "file:///w/a.test.ts";
const B_URI = "file:///w/b.test.ts";

function at(path: string[], uri: string | undefined, line: number | undefined): IWireTestItem {
    return wireItem(path, path[path.length - 1], {
        uri,
        range: line === undefined ? null : createRange(line, 0, line, 1),
    });
}

/** A live result the test drives by hand: one task, chains added as states are set. */
function liveResult(explorer: ReturnType<typeof setupExplorer>): {
    result: LiveTestResult;
    state: (path: string[], value: TestResultState, duration?: number) => void;
} {
    const result = explorer.results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
    result.addTask({ id: "t", name: "t", ctrlId: path0(explorer) });
    return {
        result,
        state: (path, value, duration) => {
            result.addTestChainToRun(
                path[0],
                path.map((_, i) => wireItem(path.slice(0, i + 1))),
            );
            result.updateState(testId(...path), "t", value, duration);
        },
    };
}

function path0(explorer: ReturnType<typeof setupExplorer>): string {
    return explorer.tests.rootItems[0]?.controllerId ?? "c";
}

/** The labels of the rows matching `names`, top to bottom. */
function order(explorer: ReturnType<typeof setupExplorer>, names: readonly string[]): string[] {
    return explorer
        .lines()
        .map((line) => names.find((name) => line.includes(` ${name} `) || line.endsWith(` ${name}`)))
        .filter((name): name is string => name !== undefined);
}

describe("Test Explorer — sortings tell their keys apart", () => {
    /** Inserted against every order: lines, labels and states disagree. */
    async function sorted() {
        const explorer = setupExplorer({ height: 16 });
        explorer.registerController("c");
        explorer.tests.publishDiff([
            add(wireItem(["c"]), Expanded),
            add(at(["c", "zz line1"], A_URI, 1), NotExpandable),
            add(at(["c", "yy line3"], A_URI, 3), NotExpandable),
            add(at(["c", "xx line2"], A_URI, 2), NotExpandable),
            add(at(["c", "bb other file"], B_URI, 0), NotExpandable),
            add(at(["c", "aa no range"], A_URI, undefined), NotExpandable),
        ]);
        await explorer.waitFrame((text) => text.includes("aa no range"));
        return explorer;
    }
    const NAMES = ["zz line1", "xx line2", "yy line3", "bb other file", "aa no range"];

    it("by location: the same file by line, otherwise by label", async () => {
        const explorer = await sorted();
        // Lines within a.test.ts; across files and without a range — labels.
        expect(order(explorer, NAMES)).toEqual(["aa no range", "bb other file", "zz line1", "xx line2", "yy line3"]);
    });

    it("by status and by duration: equal keys fall back to the location", async () => {
        const explorer = await sorted();
        const run = liveResult(explorer);
        run.state(["c", "yy line3"], Failed, 5);
        run.state(["c", "xx line2"], Passed, 5);
        run.state(["c", "zz line1"], Passed, 1);
        run.result.markComplete();
        void explorer.views.commands.execute("testing.sortByStatus");
        await vi.waitFor(() => {
            expect(order(explorer, NAMES)).toEqual([
                "yy line3",
                "zz line1",
                "xx line2",
                "aa no range",
                "bb other file",
            ]);
        });
        void explorer.views.commands.execute("testing.sortByDuration");
        await vi.waitFor(() => {
            expect(order(explorer, NAMES)).toEqual([
                "xx line2",
                "yy line3",
                "zz line1",
                "aa no range",
                "bb other file",
            ]);
        });
    });
});

describe("Test Explorer — computed states", () => {
    it("a test whose children the tree has not loaded shows its result's computed state", async () => {
        const explorer = setupExplorer();
        explorer.registerController("c");
        explorer.tests.publishDiff([
            add(wireItem(["c"]), Expanded),
            add(wireItem(["c", "file"]), Expandable),
            add(wireItem(["c", "other"]), NotExpandable),
        ]);
        const run = liveResult(explorer);
        run.state(["c", "file", "hidden"], Failed);
        run.result.markComplete();
        await explorer.waitFrame((text) => text.includes("✗ file"));
    });

    it("a suite's own state counts with its children's", async () => {
        const explorer = setupExplorer();
        explorer.registerController("c");
        explorer.tests.publishDiff([
            add(wireItem(["c"]), Expanded),
            add(wireItem(["c", "suite"]), Expanded),
            add(wireItem(["c", "suite", "t"]), NotExpandable),
            add(wireItem(["c", "x"]), NotExpandable),
        ]);
        const run = liveResult(explorer);
        run.state(["c", "suite", "t"], Passed);
        run.state(["c", "suite"], Errored);
        run.result.markComplete();
        await explorer.waitFrame((text) => text.includes("⊙ suite"));
        const { x, y } = explorer.row("suite");
        explorer.click(x, y);
        await explorer.waitFrame((text) => text.includes("✓ t"));
    });
});

describe("Test Explorer — the summary in detail", () => {
    it("two live runs count together; their spinner has the default color after a failed run; no rerun meanwhile", async () => {
        let clock = 0;
        const explorer = setupExplorer({ now: () => clock });
        explorer.registerController("c");
        explorer.tests.publishDiff([add(wireItem(["c"]), Expanded), add(wireItem(["c", "a"]), NotExpandable)]);
        const done = liveResult(explorer);
        done.state(["c", "a"], Failed);
        clock = 10;
        done.result.markComplete();
        await explorer.waitFrame((text) => text.includes("✗ 0/1"));
        const red = THEME.getColor("testing.iconFailed");
        const first = liveResult(explorer);
        const second = liveResult(explorer);
        first.state(["c", "a"], Passed);
        second.state(["c", "b"], Running);
        clock = 30;
        await explorer.waitFrame((text) => text.includes(" 1/2 20ms"));
        const line = explorer.lines()[2];
        expect(line.trimEnd()).toMatch(/1\/2 20ms$/);
        expect(explorer.fgAt(1, 2)).not.toBe(red);
    });
});

describe("Test Explorer — following and revealing in detail", () => {
    it("the cursor stays on the test that started, not on its ancestors whose computed state changes after it", async () => {
        const explorer = setupExplorer({ settings: { "testing.followRunningTest": true } });
        explorer.registerController("c");
        explorer.registerController("empty");
        explorer.tests.publishDiff([
            add(wireItem(["c"]), Expanded),
            add(wireItem(["c", "suite"]), Expanded),
            add(wireItem(["c", "suite", "t"]), NotExpandable),
            // A second controller without tests is no root of the tree.
            add(wireItem(["empty"]), NotExpandable),
        ]);
        await explorer.waitFrame((text) => text.includes(" suite"));
        const { x, y } = explorer.row("suite");
        explorer.click(x, y);
        await explorer.waitFrame((text) => /○ t\s*$/m.test(text));
        const run = liveResult(explorer);
        run.state(["c", "suite", "t"], Running);
        await vi.waitFor(() => {
            expect(explorer.component.focusedTestId).toBe(testId("c", "suite", "t"));
        });
    });

    it("after a run only the failed test's file expands; a passing file stays collapsed", async () => {
        const explorer = setupExplorer();
        explorer.registerController("c");
        explorer.tests.publishDiff([
            add(wireItem(["c"]), Expanded),
            add(wireItem(["c", "good"]), Expanded),
            add(wireItem(["c", "good", "ok"]), NotExpandable),
            add(wireItem(["c", "bad"]), Expanded),
            add(wireItem(["c", "bad", "broken"]), NotExpandable),
        ]);
        await explorer.waitFrame((text) => text.includes(" bad"));
        const run = liveResult(explorer);
        run.state(["c", "good", "ok"], Passed);
        run.state(["c", "bad", "broken"], Failed);
        run.result.markComplete();
        await explorer.waitFrame((text) => text.includes("✗ broken"));
        expect(explorer.frame()).not.toContain(" ok");
    });
});
