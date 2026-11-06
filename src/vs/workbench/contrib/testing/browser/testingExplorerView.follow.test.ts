import { describe, expect, it, vi } from "vitest";

import {
    add,
    setupExplorer,
    SwitchableIcons,
    wireItem,
} from "../../../../../TestUtils/testingExplorerHarness.ts";
import { testId } from "../../../../../TestUtils/testTree.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import {
    type IWireTestItem,
    TestItemExpandState,
    TestResultState,
    TestRunProfileBitset,
} from "../../../api/common/testingWireTypes.ts";

// Following the running test with the cursor, case by case; each case lets the reveals settle before it looks.

const { NotExpandable, Expanded } = TestItemExpandState;
const { Running, Passed, Failed, Queued } = TestResultState;

/** Time for a reveal queued after the tree's refresh. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60));

/**
 * `c` → `folder` (expanded on screen) → `file` (collapsed on screen) → `t1`, `t2`; `c` → `top`.
 * The cursor starts on `top`.
 */
async function setup(settings: Record<string, unknown> = {}, secondController = false) {
    const explorer = setupExplorer({ height: 16, settings: { "testing.followRunningTest": true, ...settings } });
    explorer.registerController("c");
    explorer.tests.publishDiff([
        add(wireItem(["c"]), Expanded),
        add(wireItem(["c", "top"]), NotExpandable),
        add(wireItem(["c", "folder"]), Expanded),
        add(wireItem(["c", "folder", "file"]), Expanded),
        add(wireItem(["c", "folder", "file", "t1"]), NotExpandable),
        add(wireItem(["c", "folder", "file", "t2"]), NotExpandable),
    ]);
    if (secondController) {
        explorer.registerController("d");
        explorer.tests.publishDiff([add(wireItem(["d"]), Expanded), add(wireItem(["d", "x"]), NotExpandable)]);
    }
    await explorer.waitFrame((text) => text.includes(" folder"));
    if (!explorer.lines().some((line) => / file\b/.test(line))) {
        const { x, y } = explorer.row("folder");
        explorer.click(x, y);
        await explorer.waitFrame((text) => / file\b/.test(text));
    }
    const top = explorer.row("top");
    explorer.click(top.x, top.y);
    await settle();
    expect(explorer.component.focusedTestId).toBe(testId("c", "top"));
    const result = explorer.results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
    result.addTask({ id: "t", name: "t", ctrlId: "c" });
    const state = (path: string[], value: TestResultState): void => {
        result.addTestChainToRun(
            path[0],
            path.map((_, i) => wireItem(path.slice(0, i + 1))),
        );
        result.updateState(testId(...path), "t", value);
    };
    return { explorer, state };
}

const T1 = ["c", "folder", "file", "t1"];

describe("Test Explorer — followRunningTest", () => {
    it("off: the cursor stays", async () => {
        const { explorer, state } = await setup({ "testing.followRunningTest": false });
        state(T1, Running);
        await settle();
        expect(explorer.component.focusedTestId).toBe(testId("c", "top"));
    });

    it("a queued test does not move it", async () => {
        const { explorer, state } = await setup();
        state(T1, Queued);
        await settle();
        expect(explorer.component.focusedTestId).toBe(testId("c", "top"));
    });

    it("a running test in a collapsed file: the cursor stops at the file, which stays collapsed", async () => {
        const { explorer, state } = await setup();
        state(T1, Running);
        await settle();
        expect(explorer.component.focusedTestId).toBe(testId("c", "folder", "file"));
        expect(explorer.frame()).not.toContain(" t1");
    });

    it("a passed one too; a failed one expands to itself", async () => {
        const { explorer, state } = await setup();
        state(T1, Passed);
        await settle();
        expect(explorer.component.focusedTestId).toBe(testId("c", "folder", "file"));
        state(["c", "folder", "file", "t2"], Failed);
        await settle();
        expect(explorer.component.focusedTestId).toBe(testId("c", "folder", "file", "t2"));
    });

    it("an ancestor whose own state is set does not take the cursor when only its computed state changes", async () => {
        const { explorer, state } = await setup({ "testing.alwaysRevealTestOnStateChange": true });
        state(["c", "folder"], Passed);
        state(T1, Running);
        await settle();
        expect(explorer.component.focusedTestId).toBe(testId(...T1));
    });

    it("with two controllers their roots are rows on the way", async () => {
        const { explorer, state } = await setup({ "testing.alwaysRevealTestOnStateChange": true }, true);
        state(T1, Running);
        await settle();
        expect(explorer.component.focusedTestId).toBe(testId(...T1));
    });
});

describe("Test Explorer — location sorting in detail", () => {
    function at(name: string, uri: string | undefined, line: number | null, sortText: string | null = null): IWireTestItem {
        return wireItem(["c", name], name, {
            uri,
            range: line === null ? null : createRange(line, 0, line, 1),
            sortText,
        });
    }

    async function shown(items: IWireTestItem[]): Promise<string[]> {
        const explorer = setupExplorer({ height: 16 });
        explorer.registerController("c");
        explorer.tests.publishDiff([add(wireItem(["c"]), Expanded), ...items.map((item) => add(item, NotExpandable))]);
        const names = items.map((item) => item.label);
        await explorer.waitFrame((text) => names.every((name) => text.includes(` ${name}`)));
        return explorer
            .lines()
            .map((line) => names.find((name) => new RegExp(`○ ${name}(\\s|$)`).test(line)))
            .filter((name): name is string => name !== undefined);
    }

    it("lines count only within one file and with both ranges", async () => {
        // No uri: labels even with ranges.
        expect(await shown([at("b1", undefined, 1), at("a2", undefined, 2)])).toEqual(["a2", "b1"]);
        // One without a range: labels.
        expect(await shown([at("b1", "file:///f", 1), at("a0", "file:///f", null)])).toEqual(["a0", "b1"]);
        expect(await shown([at("a0", "file:///f", null), at("b1", "file:///f", 1)])).toEqual(["a0", "b1"]);
    });

    it("on one line a sortText on either side decides", async () => {
        expect(await shown([at("zz", "file:///f", 1, "1"), at("yy", "file:///f", 1)])).toEqual(["zz", "yy"]);
        expect(await shown([at("yy", "file:///f", 1), at("zz", "file:///f", 1, "1")])).toEqual(["zz", "yy"]);
    });
});

describe("Test Explorer — the summary follows the icon set", () => {
    it("switching to the Nerd Font redraws the summary's glyphs", async () => {
        const icons = new SwitchableIcons();
        const explorer = setupExplorer({ icons });
        explorer.registerController("c");
        explorer.tests.publishDiff([add(wireItem(["c"]), Expanded), add(wireItem(["c", "a"]), NotExpandable)]);
        const result = explorer.results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
        result.addTask({ id: "t", name: "t", ctrlId: "c" });
        result.addTestChainToRun("c", [wireItem(["c"]), wireItem(["c", "a"])]);
        result.updateState(testId("c", "a"), "t", Passed);
        result.markComplete();
        await explorer.waitFrame((text) => text.includes("✓ 1/1"));
        icons.useNerdFont();
        await explorer.waitFrame((text) => !text.includes("✓ 1/1") && text.includes(" 1/1 "));
        await vi.waitFor(() => {
            expect(explorer.lines()[2]).not.toContain("↻");
        });
    });
});
