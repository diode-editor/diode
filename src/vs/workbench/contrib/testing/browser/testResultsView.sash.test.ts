import { BoxConstraints, Offset, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setupExplorer, THEME, wireItem } from "../../../../../TestUtils/testingExplorerHarness.ts";
import { testId } from "../../../../../TestUtils/testTree.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { TestResultState, TestRunProfileBitset } from "../../../api/common/testingWireTypes.ts";

import { MIN_CONTENT_WIDTH, MIN_TREE_WIDTH, splitWidths, TestResultsSplitElement } from "./testResultsSplitElement.ts";

// The sash between the TEST RESULTS content and its tree: hover, drag, the share kept across layouts.

const FAILS = ["vitest", "math.test.ts", "math", "fails"];
const ROW = 5;
const HOVER_COLOR = THEME.getRequiredColor("sash.hoverBorder");

function setup(settings: Readonly<Record<string, unknown>> = {}) {
    const harness = setupExplorer({ panelWidth: 100, panelHeight: 12, settings });
    const result = harness.results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
    result.addTask({ id: "t", name: "vitest", ctrlId: "vitest" });
    const uri = "file:///w/math.test.ts";
    const range = createRange(2, 0, 2, 4);
    result.addTestChainToRun(
        "vitest",
        FAILS.map((_, i) => wireItem(FAILS.slice(0, i + 1), FAILS[i], { uri, range })),
    );
    result.updateState(testId(...FAILS), "t", TestResultState.Failed);
    result.appendOutput("fails out\r\n", "t", undefined, testId(...FAILS));
    result.appendMessage(testId(...FAILS), "t", { message: "expected 2 to be 3" });
    result.markComplete();
    return harness;
}

type Harness = ReturnType<typeof setup>;

/** The content's and the tree's widths, as laid out. */
function widths(harness: Harness): { content: number; tree: number } {
    harness.panel.frame();
    const [content, tree] = harness.panel.component.view.getChildren();
    return { content: content.layoutSize.width, tree: tree.layoutSize.width };
}

function isLit(harness: Harness, x: number): boolean {
    return harness.panel.textAt(x, ROW) === "│" && harness.panel.fgAt(x, ROW) === HOVER_COLOR;
}

function drag(harness: Harness, from: number, to: number): void {
    harness.panel.mouse("press", from, ROW);
    harness.panel.mouse("move", to, ROW);
    harness.panel.mouse("release", to, ROW);
}

afterEach(() => {
    vi.useRealTimers();
});

describe("TEST RESULTS — the sash", () => {
    it("is invisible at rest, lights the tree's first column on hover, goes out on leave", async () => {
        const harness = setup();
        await harness.panel.waitFrame((text) => text.includes("fails out"));
        expect(widths(harness)).toEqual({ content: 50, tree: 50 });
        expect(harness.panel.lines()[ROW][50]).not.toBe("│");

        harness.panel.mouse("move", 50, ROW, "none");
        expect(isLit(harness, 50)).toBe(true);
        expect(isLit(harness, 49)).toBe(false);

        harness.panel.mouse("move", 70, ROW, "none");
        expect(isLit(harness, 50)).toBe(false);
    });

    it("waits `workbench.sash.hoverDelay`, and a changed delay applies live", () => {
        vi.useFakeTimers();
        const harness = setup({ "workbench.sash.hoverDelay": 300 });
        harness.panel.mouse("move", 50, ROW, "none");
        expect(isLit(harness, 50)).toBe(false);
        vi.advanceTimersByTime(300);
        expect(isLit(harness, 50)).toBe(true);

        harness.panel.mouse("move", 70, ROW, "none");
        void harness.configuration.updateValue("workbench.sash.hoverDelay", 0);
        harness.panel.mouse("move", 50, ROW, "none");
        expect(isLit(harness, 50)).toBe(true);
    });

    it("drags the boundary, also past the panel's edges, within the minimums; the line stays lit while dragging", async () => {
        const harness = setup();
        await harness.panel.waitFrame((text) => text.includes("fails out"));
        harness.panel.mouse("press", 50, ROW);
        harness.panel.mouse("move", 30, ROW);
        expect(widths(harness)).toEqual({ content: 30, tree: 70 });
        // The cursor is over the content now: the capture keeps the drag going and the line lit.
        harness.panel.mouse("move", 20, ROW);
        expect(widths(harness)).toEqual({ content: MIN_CONTENT_WIDTH, tree: 75 });
        expect(isLit(harness, MIN_CONTENT_WIDTH)).toBe(true);
        harness.panel.mouse("move", 150, ROW);
        expect(widths(harness)).toEqual({ content: 100 - MIN_TREE_WIDTH, tree: MIN_TREE_WIDTH });
        harness.panel.mouse("move", 40, ROW);
        harness.panel.mouse("release", 40, ROW);
        expect(widths(harness)).toEqual({ content: 40, tree: 60 });
        expect(harness.panel.lines()[0].slice(40)).toContain("vitest");

        // Released: moving on does not drag.
        harness.panel.mouse("move", 60, ROW, "none");
        expect(widths(harness)).toEqual({ content: 40, tree: 60 });
    });

    it("a wider or narrower panel keeps the dragged share, within the minimums", async () => {
        const harness = setup();
        await harness.panel.waitFrame((text) => text.includes("fails out"));
        drag(harness, 50, 30);
        const { view } = harness.panel.component;
        expect(laidOut(view, 200).slice(0, 2)).toEqual([60, 140]);
        expect(laidOut(view, 60).slice(0, 2)).toEqual([MIN_CONTENT_WIDTH, 35]);
        expect(laidOut(view, 30).slice(0, 2)).toEqual([MIN_CONTENT_WIDTH, 5]);
        expect(laidOut(view, 100).slice(0, 2)).toEqual([30, 70]);
    });

    it("Toggle Tree Position swaps the parts, the content keeps its width, the sash moves to the new boundary", async () => {
        const harness = setup();
        await harness.panel.waitFrame((text) => text.includes("fails out"));
        drag(harness, 50, 30);
        await harness.views.commands.execute("testing.toggleResultsViewLayout");
        expect(widths(harness)).toEqual({ content: 30, tree: 70 });
        expect(harness.panel.lines()[0].slice(0, 70)).toContain("vitest");

        harness.panel.mouse("move", 70, ROW, "none");
        expect(isLit(harness, 70)).toBe(true);
        drag(harness, 70, 60);
        expect(widths(harness)).toEqual({ content: 40, tree: 60 });
    });

    it("another subject in the content keeps the boundary", async () => {
        const harness = setup();
        await harness.panel.waitFrame((text) => text.includes("fails out"));
        drag(harness, 50, 30);
        const [output] = harness.panel.component.view.getChildren();
        const lines = harness.panel.lines();
        const y = lines.findIndex((line) => line.slice(30).includes("expected 2 to be 3"));
        harness.panel.click(30 + lines[y].slice(30).indexOf("expected"), y);
        await vi.waitFor(() => {
            expect(harness.panel.component.view.getChildren()[0]).not.toBe(output);
        });
        expect(widths(harness)).toEqual({ content: 30, tree: 70 });
    });
});

class Fill extends TUIElement {}

function laidOut(split: TestResultsSplitElement, width: number): number[] {
    split.localPosition = new Offset(0, 0);
    split.layout(BoxConstraints.tight(new Size(width, 4)));
    return split.getChildren().map((child) => child.layoutSize.width);
}

describe("TEST RESULTS — the split's widths", () => {
    it("halves until dragged; the content keeps its minimum, the tree gives way first", () => {
        expect(splitWidths(100)).toEqual({ content: 50, tree: 50 });
        expect(splitWidths(51)).toEqual({ content: 26, tree: 25 });
        expect(splitWidths(40)).toEqual({ content: MIN_CONTENT_WIDTH, tree: 15 });
        expect(splitWidths(30)).toEqual({ content: MIN_CONTENT_WIDTH, tree: 5 });
        expect(splitWidths(20)).toEqual({ content: 20, tree: 0 });
    });

    it("a dragged share scales with the width, within both minimums", () => {
        expect(splitWidths(100, 0.3)).toEqual({ content: 30, tree: 70 });
        expect(splitWidths(200, 0.3)).toEqual({ content: 60, tree: 140 });
        expect(splitWidths(100, 0.95)).toEqual({ content: 100 - MIN_TREE_WIDTH, tree: MIN_TREE_WIDTH });
        expect(splitWidths(51, 0.1)).toEqual({ content: MIN_CONTENT_WIDTH, tree: 26 });
        expect(splitWidths(40, 0.9)).toEqual({ content: 40 - MIN_TREE_WIDTH, tree: MIN_TREE_WIDTH });
        expect(splitWidths(30, 0.9)).toEqual({ content: MIN_CONTENT_WIDTH, tree: 5 });
        expect(splitWidths(20, 0.9)).toEqual({ content: 20, tree: 0 });
    });

    it("the sash is one column on the right part's first one, and none without a tree", () => {
        const split = new TestResultsSplitElement(new Fill(), new Fill(), false);
        const sash = split.getChildren()[2];
        expect(laidOut(split, 100)).toEqual([50, 50, 1]);
        expect(sash.localPosition.dx).toBe(50);
        expect(laidOut(split, 20)).toEqual([20, 0, 0]);
        split.setTreeLeft(true);
        expect(laidOut(split, 100)).toEqual([50, 50, 1]);
        expect(sash.localPosition.dx).toBe(50);
        expect(split.getChildren()[0].localPosition.dx).toBe(50);
        expect(laidOut(split, 20)).toEqual([20, 0, 0]);
    });
});
