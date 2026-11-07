import { TUIMouseEvent, type WheelDirection } from "@tuidom/core/dom/events/tuiMouseEvent";
import { describe, expect, it, vi } from "vitest";

import { setupExplorer, THEME, wireItem } from "../../../../../TestUtils/testingExplorerHarness.ts";
import { testId } from "../../../../../TestUtils/testTree.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { type IWireTestMessage, TestResultState, TestRunProfileBitset } from "../../../api/common/testingWireTypes.ts";
import type { LiveTestResult } from "../common/testResult.ts";

import { ACTUAL_LABEL, EXPECTED_LABEL } from "./testMessageView.ts";

// TEST RESULTS shows a chosen message on the left (upstream `TestResultsViewContent`): a diff of the expected and
// actual outputs, markdown, plain text; the stack's frames under it; the message's menus.

const SUITE = ["vitest", "math.test.ts", "math"];
const FAILS = [...SUITE, "fails"];
const TREE_X = 50;
const FILE = "file:///w/math.test.ts";
const HELPERS = "file:///w/helpers.ts";

function setup(height = 14) {
    const harness = setupExplorer({ panelWidth: 100, panelHeight: height });
    const executed = vi.spyOn(harness.views.commands, "execute");
    return { harness, executed };
}

type Harness = ReturnType<typeof setup>["harness"];

/** `fails` failed with the messages; the run is complete. */
function failed(harness: Harness, ...messages: IWireTestMessage[]): LiveTestResult {
    const result = harness.results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
    result.addTask({ id: "vitest", name: "vitest", ctrlId: "vitest" });
    result.addTestChainToRun(
        "vitest",
        FAILS.map((_, i) => wireItem(FAILS.slice(0, i + 1), FAILS[i], { uri: FILE, range: createRange(6, 4, 6, 20) })),
    );
    result.updateState(testId(...FAILS), "vitest", TestResultState.Failed);
    for (const message of messages) result.appendMessage(testId(...FAILS), "vitest", message);
    result.markComplete();
    return result;
}

function treeRow(harness: Harness, text: string): { y: number; line: string } {
    const lines = harness.panel.lines().map((line) => line.slice(TREE_X));
    const y = lines.findIndex((line) => line.includes(text));
    expect(y, `"${text}" in the tree:\n${lines.join("\n")}`).toBeGreaterThanOrEqual(0);
    return { y, line: lines[y] };
}

function clickRow(harness: Harness, text: string, button: "left" | "right" = "left"): void {
    const row = treeRow(harness, text);
    harness.panel.click(TREE_X + row.line.indexOf(text), row.y, button);
}

/** The content's half of the panel. */
function content(harness: Harness): string[] {
    return harness.panel.lines().map((line) => line.slice(0, TREE_X).trimEnd());
}

/** Chooses the row, waits for `shown` on the left. */
async function choose(harness: Harness, row: string, shown: string): Promise<string[]> {
    await harness.panel.waitFrame((text) => text.includes(row));
    clickRow(harness, row);
    await vi.waitFor(() => {
        expect(content(harness).join("\n")).toContain(shown);
    });
    return content(harness);
}

function menuLabels(harness: Harness, row: string): string[] {
    clickRow(harness, row, "right");
    return (harness.views.shown.at(-1)?.getEntries?.() ?? []).map((entry) =>
        entry.type === "separator" ? "-" : entry.label,
    );
}

describe("TEST RESULTS — a message's content", () => {
    it("expected and actual: a read-only diff with upstream's side labels, the sides' values in their columns", async () => {
        const { harness } = setup();
        failed(harness, { message: "expected 2 to be 3", expected: "3", actual: "2" });
        const lines = await choose(harness, "expected 2 to be 3", EXPECTED_LABEL);
        const header = lines.findIndex((line) => line.includes(EXPECTED_LABEL));
        expect(header, lines.join("\n")).toBeGreaterThanOrEqual(0);
        expect(lines[header]).toContain(ACTUAL_LABEL);
        // Side by side even in the panel's half: the expected value on the left of the actual one.
        const values = lines[header + 1];
        expect(values.indexOf("3")).toBeLessThan(values.lastIndexOf("2"));
        expect(values.indexOf("3")).toBeLessThan(values.indexOf("│"));
        // Both sides take the editor's configuration (upstream `applyEditorMirrorOptions`).
        expect(harness.panel.configuredPanes).toHaveLength(2);

        // Read-only: typing on a side changes nothing; the narrow half stays side by side once it settles.
        harness.panel.click(values.indexOf("3"), header + 1);
        harness.panel.sendKey("x");
        await new Promise((resolve) => setTimeout(resolve, 50));
        const after = content(harness);
        expect(after[header + 1]).toBe(values);
        expect(after[header]).toContain(EXPECTED_LABEL);
        expect(after[header]).toContain(ACTUAL_LABEL);
    });

    it("markdown: the hover's rendering, no markup left; plain: no ANSI codes, wrapped by words", async () => {
        const { harness } = setup();
        failed(
            harness,
            { message: "# Not equal\n\n**got** `2`, see [docs](https://x.dev)", markdown: true },
            { message: "\x1b[31mAssertionError\x1b[0m: the quick brown fox jumps over the lazy dog and keeps running" },
        );
        const markdown = await choose(harness, "Not equal", "got 2");
        expect(markdown.join("\n")).toContain("got 2, see docs");
        expect(markdown.join("\n")).not.toMatch(/[#*`[]/);

        clickRow(harness, "AssertionError");
        const plain = await harness.panel.waitFrame((text) => text.includes("AssertionError: the quick"));
        const left = plain.split("\n").map((line) => line.slice(0, TREE_X).trimEnd());
        expect(left.join("\n")).not.toContain("[31m");
        // Wrapped at a space, the word whole on the next line.
        const first = left.findIndex((line) => line.includes("AssertionError"));
        expect(left[first + 1].trim().length).toBeGreaterThan(0);
        expect(left[first].endsWith(" ")).toBe(false);
        expect(`${left[first]} ${left[first + 1].trim()}`).toContain("AssertionError: the quick brown fox");
    });

    it("an empty message shows nothing on the left; the tree's row stays", async () => {
        const { harness } = setup();
        failed(harness, { message: "" });
        await harness.panel.waitFrame((text) => text.includes("fails"));
        harness.panel.component.tree.focus();
        for (let i = 0; i < 5 && harness.panel.component.currentSubject?.kind !== "message"; i++)
            harness.panel.sendKey("ArrowDown");
        expect(harness.panel.component.currentSubject?.kind).toBe("message");
        expect(content(harness).every((line) => line.trim() === "")).toBe(true);
    });

    it("the stack: frames under the message, Enter on one with a place opens it, a frame without a place is dimmed", async () => {
        const { harness } = setup();
        failed(harness, {
            message: "boom",
            stackTrace: [
                { label: "at fails", uri: FILE, position: { line: 6, character: 8 } },
                { label: "node:internal" },
            ],
        });
        const lines = await choose(harness, "boom", "node:internal");
        const at = lines.findIndex((line) => line.includes("at fails"));
        expect(lines[at]).toContain("math.test.ts:7:9");
        const internal = lines.findIndex((line) => line.includes("node:internal"));
        expect(internal).toBe(at + 1);
        // The message's header: the test's label, the message under it.
        expect(lines[0]).toContain("fails");
        expect(lines[1]).toContain("boom");
        const x = lines[internal].indexOf("node:internal");
        expect(harness.panel.fgAt(x, internal)).toBe(THEME.getRequiredColor("descriptionForeground"));

        const { frames } = harness.panel.component.message;
        frames.focus();
        harness.panel.sendKey("Enter");
        expect(harness.panel.opened).toEqual([{ uri: FILE, line: 6, character: 8 }]);
        harness.panel.sendKey("ArrowDown");
        harness.panel.sendKey("Enter");
        expect(harness.panel.opened).toHaveLength(1);
        expect(harness.views.contextKeys.get("testing.peekHasStack")).toBe(true);

        // A frame has nothing under it: Right on either adds no rows.
        harness.panel.sendKey("ArrowRight");
        harness.panel.sendKey("ArrowUp");
        harness.panel.sendKey("ArrowRight");
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(content(harness).filter((line) => line.includes("node:internal"))).toHaveLength(1);
        // A click opens the frame as Enter does: upstream's frame header is a link.
        harness.panel.click(lines[at].indexOf("at fails"), at);
        expect(harness.panel.opened).toEqual([
            { uri: FILE, line: 6, character: 8 },
            { uri: FILE, line: 6, character: 8 },
        ]);
    });

    it("Collapse Stack Frames folds the message, the frames take its rows; a click on the header unfolds it", async () => {
        const { harness } = setup(8);
        const stackTrace = Array.from({ length: 10 }, (_, i) => ({ label: `frame ${String(i)}`, uri: FILE }));
        failed(harness, { message: "boom", stackTrace });
        const before = await choose(harness, "boom", "frame 2");
        expect(before.join("\n")).toContain("boom");
        expect(before.join("\n")).not.toContain("frame 5");
        await harness.views.commands.execute("testing.collapsePeekStack");
        const folded = content(harness);
        expect(folded.join("\n")).not.toContain("boom");
        expect(folded.join("\n")).toContain("frame 5");
        // The header's chevron turns: one glyph unfolded, another folded.
        const chevron = (line: string): string => line.slice(0, 2).trim();
        expect(chevron(before[0])).not.toBe("");
        expect(chevron(folded[0])).not.toBe("");
        expect(chevron(folded[0])).not.toBe(chevron(before[0]));
        harness.panel.click(2, 0);
        expect(content(harness).join("\n")).toContain("boom");
    });

    it("a tall panel: the stack takes half of the rows under the header, the message the other half", async () => {
        const { harness } = setup(16);
        const stackTrace = Array.from({ length: 12 }, (_, i) => ({ label: `frame ${String(i)}`, uri: FILE }));
        failed(harness, { message: "boom", stackTrace });
        const lines = await choose(harness, "boom", "frame 2");
        const frames = lines.filter((line) => line.includes("frame "));
        expect(frames.length).toBe(Math.floor((lines.length - 1) / 2));
        expect(lines[1]).toContain("boom");
    });

    it("the text takes the keyboard: arrows by a line, pages by the height less one, Home and End to the ends", async () => {
        const { harness } = setup(6);
        failed(
            harness,
            { message: Array.from({ length: 30 }, (_, i) => `row ${String(i)}`).join("\n") },
            { message: "other text" },
        );
        await choose(harness, "row 0", "row 1");
        const row = (line: string | undefined): string => (line ?? "").slice(0, 10).trim();
        const top = (): string => row(content(harness)[0]);
        const text = harness.panel.component.message.element.getChildren()[0].getChildren()[0];
        expect(harness.panel.fgAt(0, 0)).toBe(THEME.getRequiredColor("foreground"));
        text.focus();
        expect(text.isFocused).toBe(true);
        harness.panel.sendKey("ArrowDown");
        expect(top()).toBe("row 1");
        harness.panel.sendKey("PageDown");
        expect(top()).toBe("row 6");
        harness.panel.sendKey("PageUp");
        harness.panel.sendKey("ArrowUp");
        expect(top()).toBe("row 0");
        harness.panel.sendKey("End");
        expect(row(content(harness).at(-1))).toBe("row 29");
        harness.panel.sendKey("Ctrl+Home");
        expect(row(content(harness).at(-1))).toBe("row 29");
        harness.panel.sendKey("Home");
        expect(top()).toBe("row 0");

        // The wheel scrolls three lines a notch, as the editor.
        const wheel = (wheelDirection: WheelDirection): void => {
            text.dispatchEvent(
                new TUIMouseEvent("wheel", {
                    button: "none",
                    screenX: 0,
                    screenY: 0,
                    localX: 0,
                    localY: 0,
                    wheelDirection,
                }),
            );
        };
        wheel("down");
        expect(top()).toBe("row 3");
        wheel("up");
        expect(top()).toBe("row 0");
        // A sideways notch: the text wraps, there is nothing to the side.
        wheel("down");
        wheel("right");
        expect(top()).toBe("row 3");

        // Another message starts at its top, and so does this one again.
        await choose(harness, "other text", "other text");
        await choose(harness, "row 0", "row 0");
        expect(top()).toBe("row 0");

        // Other keys are not the text's: Tab moves on.
        text.focus();
        harness.panel.sendKey("Tab");
        expect(text.isFocused).toBe(false);
    });

    it("a short panel: two frames wider than the content take two rows, no horizontal bar under them", async () => {
        const { harness } = setup(6);
        const long = "x".repeat(80);
        failed(harness, {
            message: "boom",
            stackTrace: [
                { label: `first ${long}`, uri: FILE },
                { label: `second ${long}`, uri: FILE },
            ],
        });
        const lines = await choose(harness, "boom", "second");
        expect(lines.findIndex((line) => line.includes("second"))).toBe(
            lines.findIndex((line) => line.includes("first")) + 1,
        );
        expect(lines.join("\n")).not.toContain("▄");
    });

    it("a message without a stack has no header; choosing the task again brings the output back", async () => {
        const { harness } = setup();
        failed(harness, { message: "boom" });
        const lines = await choose(harness, "boom", "boom");
        expect(lines[0]).toContain("boom");
        expect(harness.views.contextKeys.get("testing.peekHasStack")).toBe(false);
        clickRow(harness, "vitest");
        await harness.panel.waitFrame((text) => text.includes("did not record any output"));
        expect(harness.views.contextKeys.get("testing.peekHasStack")).toBeUndefined();
        // No message shown: Collapse Stack Frames has nothing to fold.
        await harness.views.commands.execute("testing.collapsePeekStack");
        expect(content(harness).join("\n")).toContain("did not record any output");
    });
});

describe("TEST RESULTS — a removed run", () => {
    it("Clear All Results takes the shown message off the left: the output's surface is there again", async () => {
        const { harness } = setup();
        failed(harness, { message: "boom" });
        await choose(harness, "boom", "boom");
        const { element } = harness.panel.component.message;
        expect(element.getParent()).not.toBeNull();
        harness.results.clear();
        expect(element.getParent()).toBeNull();
        expect(harness.views.contextKeys.get("testing.peekHasStack")).toBeUndefined();
    });
});

describe("TEST RESULTS — a message's actions", () => {
    const LOCATED: IWireTestMessage = {
        message: "expected 2 to be 3",
        contextValue: "ctx-1",
        location: { uri: HELPERS, range: createRange(7, 8, 7, 30) },
    };

    it("Go to Error: inline on the row and in its menu, the message's place opened", async () => {
        const { harness } = setup();
        failed(harness, LOCATED, { message: "nowhere" });
        await harness.panel.waitFrame((text) => text.includes("nowhere"));
        expect(menuLabels(harness, "nowhere")).toEqual([]);
        expect(menuLabels(harness, "expected 2 to be 3")).toEqual(["Go to Error"]);
        const entry = harness.views.shown.at(-1)?.getEntries?.()[0];
        if (entry?.type !== "separator" && entry?.type !== "submenu") entry?.onSelect?.();
        expect(harness.panel.opened).toEqual([{ uri: HELPERS, line: 7, character: 8 }]);
    });

    it("testing/message/context and content: items by the message's keys, the command gets the message", async () => {
        const { harness, executed } = setup();
        const when =
            "testMessage == 'ctx-1' && resourcePath == '/w/helpers.ts' && controllerId == vitest && testId == fails && !testResultOutdated";
        // The `inline` group is the row's: before the separator.
        harness.views.menuRegistry.appendMenuItem({
            menuId: MenuId.TestMessageContext,
            command: "ext.inline",
            title: "Inline",
            group: "inline",
            when,
        });
        for (const menuId of [MenuId.TestMessageContext, MenuId.TestMessageContent]) {
            harness.views.menuRegistry.appendMenuItem({
                menuId,
                command: "vitest.copyErrorOutput",
                title: "Copy Error",
                when,
            });
        }
        failed(harness, LOCATED, { message: "other", contextValue: "ctx-2" });
        await harness.panel.waitFrame((text) => text.includes("other"));
        expect(menuLabels(harness, "other")).toEqual([]);
        expect(menuLabels(harness, "expected 2 to be 3")).toEqual(["Go to Error", "Inline", "-", "Copy Error"]);
        const copy = harness.views.shown.at(-1)?.getEntries?.()[3];
        if (copy?.type !== "separator" && copy?.type !== "submenu") copy?.onSelect?.();
        const arg = { $testMessageTestId: testId(...FAILS), message: expect.objectContaining(LOCATED) as unknown };
        expect(executed).toHaveBeenLastCalledWith("vitest.copyErrorOutput", arg);

        // Over the shown message: its button.
        executed.mockClear();
        clickRow(harness, "expected 2 to be 3");
        const header = await harness.panel.waitFrame((text) => text.includes("Copy Error"));
        const y = header.split("\n").findIndex((line) => line.slice(0, TREE_X).includes("Copy Error"));
        const button = header.split("\n")[y].indexOf("Copy Error");
        // Without a stack the header has no label: only the buttons.
        expect(
            header
                .split("\n")
                [y].slice(0, button - 2)
                .trim(),
        ).toBe("");
        harness.panel.click(button, y);
        expect(executed).toHaveBeenLastCalledWith("vitest.copyErrorOutput", arg);
    });

    it("a message without a place of a test without a file has no resource keys; no context value, no testMessage", async () => {
        const { harness } = setup();
        harness.views.menuRegistry.appendMenuItem({
            menuId: MenuId.TestMessageContext,
            command: "ext.nowhere",
            title: "Nowhere",
            when: "!testMessage && !resourcePath",
        });
        const result = harness.results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
        result.addTask({ id: "vitest", name: "vitest", ctrlId: "vitest" });
        result.addTestChainToRun(
            "vitest",
            FAILS.map((_, i) => wireItem(FAILS.slice(0, i + 1))),
        );
        result.updateState(testId(...FAILS), "vitest", TestResultState.Failed);
        result.appendMessage(testId(...FAILS), "vitest", { message: "unplaced" });
        result.markComplete();
        await harness.panel.waitFrame((text) => text.includes("unplaced"));
        expect(menuLabels(harness, "unplaced")).toEqual(["Nowhere"]);
    });

    it("a failing command of the message's menu is a toast", async () => {
        const { harness } = setup();
        harness.views.commands.register("ext.fail", () => {
            throw new Error("no clipboard");
        });
        harness.views.menuRegistry.appendMenuItem({
            menuId: MenuId.TestMessageContext,
            command: "ext.fail",
            title: "Fail",
        });
        failed(harness, { message: "boom" });
        await harness.panel.waitFrame((text) => text.includes("boom"));
        clickRow(harness, "boom", "right");
        const entry = harness.views.shown.at(-1)?.getEntries?.()[0];
        if (entry?.type !== "separator" && entry?.type !== "submenu") entry?.onSelect?.();
        await vi.waitFor(() => {
            expect(harness.toastOptions).toEqual([
                { severity: "error", message: "no clipboard", modal: false, items: [] },
            ]);
        });
    });
});
