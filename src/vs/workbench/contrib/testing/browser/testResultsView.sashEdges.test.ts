import { describe, expect, it } from "vitest";

import { setupExplorer, wireItem } from "../../../../../TestUtils/testingExplorerHarness.ts";
import { testId } from "../../../../../TestUtils/testTree.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { TestResultState, TestRunProfileBitset } from "../../../api/common/testingWireTypes.ts";

// The TEST RESULTS sash at its edges: clicks that are not drags, a drag started elsewhere, a new run, treeLeft at rest.

const FAILS = ["vitest", "math.test.ts", "math", "fails"];
const ROW = 5;

type Harness = ReturnType<typeof setupExplorer>;

function run(harness: Harness, out: string): void {
    const result = harness.results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
    result.addTask({ id: "t", name: "vitest", ctrlId: "vitest" });
    const uri = "file:///w/math.test.ts";
    const range = createRange(2, 0, 2, 4);
    result.addTestChainToRun(
        "vitest",
        FAILS.map((_, i) => wireItem(FAILS.slice(0, i + 1), FAILS[i], { uri, range })),
    );
    result.updateState(testId(...FAILS), "t", TestResultState.Failed);
    result.appendOutput(`${out}\r\n`, "t", undefined, testId(...FAILS));
    result.appendMessage(testId(...FAILS), "t", { message: "expected 2 to be 3" });
    result.markComplete();
}

async function setup(settings: Readonly<Record<string, unknown>> = {}): Promise<Harness> {
    const harness = setupExplorer({ panelWidth: 100, panelHeight: 12, settings });
    run(harness, "fails out");
    await harness.panel.waitFrame((text) => text.includes("fails out"));
    return harness;
}

function widths(harness: Harness): { content: number; tree: number } {
    harness.panel.frame();
    const [content, tree] = harness.panel.component.view.getChildren();
    return { content: content.layoutSize.width, tree: tree.layoutSize.width };
}

function drag(harness: Harness, from: number, to: number): void {
    harness.panel.mouse("press", from, ROW);
    harness.panel.mouse("move", to, ROW);
    harness.panel.mouse("release", to, ROW);
}

describe("TEST RESULTS — the sash at its edges", () => {
    it("a plain click on the sash after a drag keeps the boundary", async () => {
        const harness = await setup();
        drag(harness, 50, 30);
        harness.panel.click(30, ROW);
        expect(widths(harness)).toEqual({ content: 30, tree: 70 });
    });

    it("a second drag starts from where the boundary is, without a jump", async () => {
        const harness = await setup();
        drag(harness, 50, 30);
        harness.panel.mouse("press", 30, ROW);
        harness.panel.mouse("move", 31, ROW);
        expect(widths(harness)).toEqual({ content: 31, tree: 69 });
        harness.panel.mouse("release", 31, ROW);
    });

    it("a press in the output and a move across the boundary drags nothing", async () => {
        const harness = await setup();
        harness.panel.mouse("press", 10, ROW);
        harness.panel.mouse("move", 50, ROW);
        harness.panel.mouse("move", 70, ROW);
        harness.panel.mouse("release", 70, ROW);
        expect(widths(harness)).toEqual({ content: 50, tree: 50 });
    });

    it("a new run keeps the boundary", async () => {
        const harness = await setup();
        drag(harness, 50, 30);
        run(harness, "second run out");
        await harness.panel.waitFrame((text) => text.includes("second run out"));
        expect(widths(harness)).toEqual({ content: 30, tree: 70 });
    });

    it("a click on a tree row right of the sash still selects it", async () => {
        const harness = await setup();
        drag(harness, 50, 30);
        const [output] = harness.panel.component.view.getChildren();
        const lines = harness.panel.lines();
        const y = lines.findIndex((line) => line.slice(30).includes("expected 2 to be 3"));
        // The sash takes column 30 only: the first cell of the row's text right of it is the tree's.
        harness.panel.click(32, y);
        await expect.poll(() => harness.panel.component.view.getChildren()[0] !== output, { timeout: 2000 }).toBe(true);
    });

    it("with the tree on the left, the output's first column shows its text at rest", async () => {
        const harness = await setup({ "testing.resultsView.layout": "treeLeft" });
        const lines = harness.panel.lines();
        const y = lines.findIndex((line) => line.slice(50).includes("fails out"));
        expect(y).toBeGreaterThanOrEqual(0);
        expect(lines[y].slice(50)).toMatch(/^fails out/);
    });
});
