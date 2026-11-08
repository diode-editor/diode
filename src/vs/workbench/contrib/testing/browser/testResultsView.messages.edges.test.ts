import { describe, expect, it, vi } from "vitest";

import { setupExplorer, wireItem } from "../../../../../TestUtils/testingExplorerHarness.ts";
import { testId } from "../../../../../TestUtils/testTree.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { type IWireTestMessage, TestResultState, TestRunProfileBitset } from "../../../api/common/testingWireTypes.ts";

// Edge cases of a message's content in TEST RESULTS, seen on the panel's frame.

const SUITE = ["vitest", "math.test.ts", "math"];
const FAILS = [...SUITE, "fails"];
const TREE_X = 50;
const FILE = "file:///w/math.test.ts";

function setup(height = 14) {
    return setupExplorer({ panelWidth: 100, panelHeight: height });
}

type Harness = ReturnType<typeof setup>;

function failed(harness: Harness, ...messages: IWireTestMessage[]): void {
    const result = harness.results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
    result.addTask({ id: "vitest", name: "vitest", ctrlId: "vitest" });
    result.addTestChainToRun(
        "vitest",
        FAILS.map((_, i) => wireItem(FAILS.slice(0, i + 1), FAILS[i], { uri: FILE, range: createRange(6, 4, 6, 20) })),
    );
    result.updateState(testId(...FAILS), "vitest", TestResultState.Failed);
    for (const message of messages) result.appendMessage(testId(...FAILS), "vitest", message);
    result.markComplete();
}

function content(harness: Harness): string[] {
    return harness.panel.lines().map((line) => line.slice(0, TREE_X).trimEnd());
}

async function choose(harness: Harness, row: string, shown: string): Promise<string[]> {
    await harness.panel.waitFrame((text) => text.includes(row));
    const lines = harness.panel.lines().map((line) => line.slice(TREE_X));
    const y = lines.findIndex((line) => line.includes(row));
    expect(y, lines.join("\n")).toBeGreaterThanOrEqual(0);
    harness.panel.click(TREE_X + lines[y].indexOf(row), y);
    await vi.waitFor(() => {
        expect(content(harness).join("\n")).toContain(shown);
    });
    return content(harness);
}

describe("TEST RESULTS — message edge cases", () => {
    it("only an expected value is not a diff: the message is shown as text", async () => {
        const harness = setup();
        failed(harness, { message: "only expected", expected: "3" });
        const lines = await choose(harness, "only expected", "only expected");
        expect(lines.join("\n")).not.toContain("Expected result");
    });

    it("only an actual value is not a diff either", async () => {
        const harness = setup();
        failed(harness, { message: "only actual", actual: "2" });
        const lines = await choose(harness, "only actual", "only actual");
        expect(lines.join("\n")).not.toContain("Actual result");
    });

    it("a long plain message: the keyboard reaches its text and scrolls it to the last line", async () => {
        const harness = setup(10);
        const message = Array.from({ length: 60 }, (_, i) => `row ${String(i)}`).join("\n");
        failed(harness, { message });
        await choose(harness, "row 0", "row 1");
        // From the tree back through the panel, as a keyboard user does; each stop gets End and PageDowns.
        for (let stop = 0; stop < 4 && !content(harness).join("\n").includes("row 59"); stop++) {
            harness.panel.sendKey("Shift+Tab");
            harness.panel.sendKey("End");
            for (let i = 0; i < 10; i++) harness.panel.sendKey("PageDown");
        }
        expect(content(harness).join("\n")).toContain("row 59");
    });

    it("wide characters keep their text", async () => {
        const harness = setup();
        failed(harness, { message: "期待値と実際の値が違います 🚀 done" });
        const lines = await choose(harness, "期待値", "期待値");
        expect(lines.join("\n")).toContain("期待値と実際の値が違います 🚀 done");
    });

    it("a markdown table is drawn as text", async () => {
        const harness = setup();
        failed(harness, { message: "| col | other |\n|---|---|\n| one | two |", markdown: true });
        const lines = await choose(harness, "col", "two");
        expect(lines.join("\n")).toContain("one");
    });

    it("ANSI codes of other shapes are removed: bold+color, erase line, cursor, OSC hyperlink", async () => {
        const harness = setup();
        failed(harness, {
            message: "\x1b[1;31mFAIL\x1b[22;39m \x1b[2Kx\x1b[1A \x1b]8;;https://x.dev\x07link\x1b]8;;\x07 end",
        });
        const lines = await choose(harness, "FAIL", "end");
        const text = lines.join("\n");
        expect(text).toContain("FAIL");
        expect(text).toContain("link end");
        expect(text).not.toMatch(/\[\d|\]8;/);
        expect(text).not.toContain("\u001b");
    });

    it("CRLF lines of a plain message show no carriage returns", async () => {
        const harness = setup();
        failed(harness, { message: "first\r\nsecond\r\nthird" });
        const lines = await choose(harness, "first", "third");
        const at = lines.findIndex((line) => line.includes("first"));
        expect(lines[at].trim()).toBe("first");
        expect(lines[at + 1].trim()).toBe("second");
    });

    it("a frame with a uri but no position opens the file at its start", async () => {
        const harness = setup();
        failed(harness, { message: "boom", stackTrace: [{ label: "at fails", uri: FILE }] });
        const lines = await choose(harness, "boom", "at fails");
        // Its description is the file alone, no line and column.
        expect(lines.find((line) => line.includes("at fails"))?.trimEnd()).toMatch(/at fails\s+math\.test\.ts$/);
        harness.panel.component.message.frames.focus();
        harness.panel.sendKey("Enter");
        expect(harness.panel.opened).toEqual([{ uri: FILE, line: 0, character: 0 }]);
    });

    it("switching from a diff to a plain message and back shows each one", async () => {
        const harness = setup();
        failed(harness, { message: "diffy", expected: "3", actual: "2" }, { message: "plainy text" });
        await choose(harness, "diffy", "Expected result");
        const plain = await choose(harness, "plainy", "plainy text");
        expect(plain.join("\n")).not.toContain("Expected result");
        await choose(harness, "diffy", "Expected result");
    });
});
