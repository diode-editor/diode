import { describe, expect, it, vi } from "vitest";

import { createRange } from "../../../../editor/common/core/iRange.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { SPINNER_FRAMES } from "../../../../platform/progress/common/progressService.ts";
import { TestItemExpandState, type WireTestsDiffOp } from "../../../api/common/testingWireTypes.ts";

import { add, setupExplorer, THEME, update, wireItem } from "./testingExplorerView.testUtils.ts";
import { TESTING_EXPLORER_VIEW_ID, TESTING_VIEWLET_ID } from "./testingExplorerView.ts";

const { NotExpandable, Expandable, BusyExpanding, Expanded } = TestItemExpandState;

const FILE_URI = "file:///w/src/math.test.ts";
const ROOT = ["vitest"];
const SRC = ["vitest", "src"];
const FILE = ["vitest", "src", "math.test.ts"];
const SUITE = [...FILE, "math"];
const ADDS = [...SUITE, "adds"];
const FAILS = [...SUITE, "fails"];

/** What `vitest.explorer` publishes: the root, then folders and files on the root's resolve. */
function vitestRoot(): WireTestsDiffOp[] {
    return [add(wireItem(ROOT, "Vitest"), Expandable)];
}

function vitestFiles(): WireTestsDiffOp[] {
    return [
        add(wireItem(SRC), NotExpandable),
        add(wireItem(FILE, "math.test.ts", { uri: FILE_URI }), Expandable),
        update(ROOT, {}, Expanded),
    ];
}

/** A file's tests, on its resolve. */
function vitestTests(): WireTestsDiffOp[] {
    return [
        add(wireItem(SUITE, "math", { uri: FILE_URI, range: createRange(2, 0, 9, 2) }), NotExpandable),
        add(wireItem(ADDS, "adds", { uri: FILE_URI, range: createRange(3, 4, 5, 6) }), NotExpandable),
        add(wireItem(FAILS, "fails", { uri: FILE_URI, range: createRange(6, 4, 8, 6) }), NotExpandable),
        update(FILE, {}, Expanded),
    ];
}

/** A controller with `src/math.test.ts` listed and its tests resolved and shown. */
async function withTests(options: Parameters<typeof setupExplorer>[0] = {}) {
    const explorer = setupExplorer(options);
    explorer.registerController("vitest", "Vitest");
    explorer.tests.publishDiff([...vitestRoot(), ...vitestFiles(), ...vitestTests()]);
    for (const [label, next] of [
        ["src", "math.test.ts"],
        ["math.test.ts", "math"],
        ["math", "adds"],
    ] as const) {
        await explorer.waitFrame((text) => text.includes(` ${label}`));
        const { x, y } = explorer.row(label);
        explorer.click(x, y);
        await explorer.waitFrame((text) => text.includes(` ${next}`));
    }
    return explorer;
}

describe("TestingExplorerComponent — the container follows the controllers", () => {
    it("no controller — no Testing in the sidebar; the first one brings it, the last one takes it away", async () => {
        const { views, registerController } = setupExplorer();
        const present = (): boolean => views.viewlets.includes(TESTING_VIEWLET_ID);
        expect(present()).toBe(false);
        const first = registerController("vitest");
        await vi.waitFor(() => {
            expect(present()).toBe(true);
        });
        const second = registerController("go");
        first.dispose();
        await Promise.resolve();
        expect(present()).toBe(true);
        second.dispose();
        await vi.waitFor(() => {
            expect(present()).toBe(false);
        });
    });

    it("a controller without tests shows upstream's welcome with the button", async () => {
        const { tests, registerController, waitFrame } = setupExplorer({ width: 60 });
        registerController("vitest", "Vitest");
        tests.publishDiff([add(wireItem(ROOT, "Vitest"), Expanded)]);
        const frame = await waitFrame((text) => text.includes("No tests have been found"));
        expect(frame).toContain("Install Additional Test Extensions...");
        expect(frame).not.toContain("Filter (e.g.");
    });

    it("a controller that comes back without tests gets the welcome, not the tree it left", async () => {
        const { tests, registerController, waitFrame } = setupExplorer({ width: 60 });
        const first = registerController("vitest", "Vitest");
        tests.publishDiff([...vitestRoot(), ...vitestFiles()]);
        await waitFrame((text) => text.includes("src"));
        first.dispose();
        await vi.waitFor(() => {
            expect(tests.rootItems).toEqual([]);
        });
        registerController("go", "Go");
        tests.publishDiff([add(wireItem(["go"], "Go"), Expanded)]);
        await waitFrame((text) => text.includes("No tests have been found"));
    });

    it("a diff before any controller's view exists draws nothing and throws nothing", async () => {
        const { tests, views } = setupExplorer();
        tests.publishDiff(vitestRoot());
        await Promise.resolve();
        await Promise.resolve();
        expect(views.viewlets).not.toContain(TESTING_VIEWLET_ID);
    });

    it("the root resolves once the view shows it; while the controller is busy there is no welcome", async () => {
        const { tests, registerController, waitFrame, expands, frame } = setupExplorer();
        registerController("vitest", "Vitest");
        tests.publishDiff(vitestRoot());
        await vi.waitFor(() => {
            expect(expands).toEqual([["vitest", 0]]);
        });
        tests.publishDiff([update(ROOT, {}, BusyExpanding)]);
        await waitFrame((text) => text.includes("No test results yet."));
        tests.publishDiff(vitestFiles());
        await waitFrame((text) => text.includes("src"));
        expect(frame()).not.toContain("No tests have been found");
    });
});

describe("TestingExplorerComponent — the tree", () => {
    it("one controller: its tests are the roots; the filter, the summary, state icons and the hierarchy", async () => {
        const { lines } = await withTests();
        const shown = lines().map((line) => line.trimEnd());
        // The filter field fills the row, the glyph sits at its end.
        expect(shown.slice(0, 7)).toEqual([
            " TEST EXPLORER ▾                      ⋯",
            " Filter (e.g. text, !exclude, @tag)   ▽",
            " No test results yet.",
            " ▾ ○ src",
            "   ▾ ○ math.test.ts",
            // The cursor is on `math`: its Go to Test glyph.
            "     ▾ ○ math                         ↗",
            "         ○ adds",
        ]);
    });

    it("the state icon is drawn in testing.iconUnset", async () => {
        const { locate, fgAt } = await withTests();
        const { x, y } = locate("○ adds");
        expect(fgAt(x, y)).toBe(THEME.getColor("testing.iconUnset"));
    });

    it("two controllers: the controllers are the roots, by their labels", async () => {
        const { tests, registerController, waitFrame } = setupExplorer();
        registerController("vitest", "Vitest");
        registerController("go", "Go");
        tests.publishDiff([...vitestRoot(), ...vitestFiles()]);
        tests.publishDiff([add(wireItem(["go"], "Go"), Expanded), add(wireItem(["go", "a_test.go"]), NotExpandable)]);
        const frame = await waitFrame((text) => text.includes("a_test.go"));
        expect(frame).toContain("▾ ○ Vitest");
        expect(frame).toContain("▾ ○ Go");
        expect(frame).toContain("○ src");
    });

    it("children go by sortText, else by label", async () => {
        const { tests, registerController, waitFrame, lines } = setupExplorer();
        registerController("vitest", "Vitest");
        tests.publishDiff([
            add(wireItem(ROOT, "Vitest"), Expanded),
            add(wireItem(["vitest", "b"], "beta"), NotExpandable),
            add(wireItem(["vitest", "a"], "alpha", { sortText: "z" }), NotExpandable),
            add(wireItem(["vitest", "c"], "gamma"), NotExpandable),
        ]);
        await waitFrame((text) => text.includes("gamma"));
        const rows = lines()
            .filter((line) => /alpha|beta|gamma/.test(line))
            .map((line) => line.trim());
        expect(rows).toEqual(["○ beta", "○ gamma", "○ alpha"]);
    });

    it("the description is dimmed after the label", async () => {
        const { tests, registerController, waitFrame, locate, fgAt } = setupExplorer();
        registerController("vitest", "Vitest");
        tests.publishDiff([
            add(wireItem(ROOT, "Vitest"), Expanded),
            add(wireItem(["vitest", "a"], "adds"), NotExpandable),
            add(wireItem(["vitest", "b"], "bdds", { description: "fast" }), NotExpandable),
        ]);
        // Off the cursor row: the cursor row draws everything in the selection foreground.
        await waitFrame((text) => text.includes("bdds fast"));
        const { x, y } = locate("fast");
        expect(fgAt(x, y)).not.toBe(fgAt(locate("bdds").x, y));
    });

    it("expanding a lazy test asks the controller, shows a spinner while it resolves, then the children", async () => {
        const { tests, registerController, waitFrame, expands, locate, click } = setupExplorer();
        registerController("vitest", "Vitest");
        tests.publishDiff([...vitestRoot(), ...vitestFiles()]);
        await waitFrame((text) => text.includes("src"));
        const src = locate("src");
        click(src.x, src.y);
        await waitFrame((text) => text.includes("math.test.ts"));
        const file = locate("math.test.ts");
        click(file.x, file.y);
        await vi.waitFor(() => {
            expect(expands).toContainEqual([FILE.join("\0"), 0]);
        });
        tests.publishDiff([update(FILE, {}, BusyExpanding)]);
        await waitFrame((text) => text.includes(`${SPINNER_FRAMES[0]} math.test.ts`));
        tests.publishDiff(vitestTests());
        const frame = await waitFrame((text) => text.includes("○ math.test.ts") && text.includes("○ math"));
        expect(frame).not.toContain(SPINNER_FRAMES[0]);
    });

    it("a busy test spins instead of its state icon", async () => {
        const { tests, waitFrame } = await withTests();
        tests.publishDiff([update(ADDS, { busy: true })]);
        await waitFrame((text) => text.includes(`${SPINNER_FRAMES[0]} adds`));
        tests.publishDiff([update(ADDS, { busy: false })]);
        await waitFrame((text) => text.includes("○ adds"));
    });

    it("an update in place keeps the expansion and the cursor", async () => {
        const { tests, component, locate, click, waitFrame } = await withTests();
        const { x, y } = locate("fails");
        click(x, y);
        expect(component.focusedTestId).toBe(FAILS.join("\0"));
        tests.publishDiff([update(ADDS, { label: "adds two" })]);
        await waitFrame((text) => text.includes("adds two") && text.includes("fails"));
        expect(component.focusedTestId).toBe(FAILS.join("\0"));
    });

    it("a test with an error shows the error under it in the list's error color, expanded", async () => {
        const { tests, waitFrame, locate, fgAt } = await withTests();
        tests.publishDiff([update(SUITE, { error: "Cannot parse math" })]);
        await waitFrame((text) => text.includes("Cannot parse math"));
        const { x, y } = locate("Cannot parse math");
        expect(fgAt(x, y)).toBe(THEME.getColor("list.errorForeground"));
    });

    it("workbench.tree.renderIndentGuides changed in the settings repaints the guides", async () => {
        const { setSetting, waitFrame } = await withTests();
        setSetting("workbench.tree.renderIndentGuides", "always");
        await waitFrame((text) => text.includes("│"));
    });

    it("a removed test goes from the frame", async () => {
        const { tests, waitFrame } = await withTests();
        tests.publishDiff([{ op: 3, itemId: FAILS.join("\0") }]);
        const frame = await waitFrame((text) => !text.includes("fails"));
        expect(frame).toContain("adds");
    });
});

describe("TestingExplorerComponent — the filter", () => {
    it("`!text` hides the matching tests; clearing brings them back", async () => {
        const { component, waitFrame } = await withTests();
        component.filterInput.inputState.value = "!fails";
        component.filterInput.onChange?.("!fails");
        const frame = await waitFrame((text) => !text.includes("fails"));
        expect(frame).toContain("adds");
        component.filterInput.inputState.value = "";
        component.filterInput.onChange?.("");
        await waitFrame((text) => text.includes("fails"));
    });

    it("a match expands the tree to it; ancestors stay, the rest goes", async () => {
        const { component, waitFrame, locate, click, lines } = await withTests();
        // Collapse the file: the filter has to open it again.
        const file = locate("math.test.ts");
        click(file.x - 2, file.y);
        await waitFrame((text) => !text.includes("adds"));
        component.filterInput.inputState.value = "adds";
        component.filterInput.onChange?.("adds");
        await waitFrame((text) => text.includes("adds") && !text.includes("fails"));
        expect(lines().some((line) => line.includes("math.test.ts"))).toBe(true);
    });

    it("nothing matches — an empty tree without text", async () => {
        const { component, waitFrame, lines } = await withTests();
        component.filterInput.inputState.value = "nothing";
        component.filterInput.onChange?.("nothing");
        await waitFrame((text) => !text.includes("src"));
        expect(
            lines()
                .slice(3)
                .every((line) => line.trim() === ""),
        ).toBe(true);
    });

    it("typing goes into the field; ArrowDown goes to the tree, ArrowUp on the first row comes back", async () => {
        const { component, sendKey, waitFrame } = await withTests();
        component.filterInput.focus();
        for (const key of "!fails") sendKey(key);
        await waitFrame((text) => text.includes("!fails") && !text.includes("○ fails"));
        sendKey("ArrowDown");
        expect(component.tree.isFocused).toBe(true);
        // The cursor is on `math`, the third row: two steps up to `src`, the third leaves the tree.
        sendKey("ArrowUp");
        sendKey("ArrowUp");
        expect(component.tree.isFocused).toBe(true);
        sendKey("ArrowUp");
        expect(component.filterInput.isFocused).toBe(true);
    });

    it("Escape clears the field; on an empty field it is left alone", async () => {
        const { component, sendKey, waitFrame } = await withTests();
        component.filterInput.focus();
        for (const key of "fails") sendKey(key);
        await waitFrame((text) => !text.includes("○ adds"));
        sendKey("Escape");
        await waitFrame((text) => text.includes("○ adds"));
        expect(component.filterInput.inputState.value).toBe("");
        expect(component.filterInput.isFocused).toBe(true);
    });
});

describe("TestingExplorerComponent — Go to Test", () => {
    it("Enter on a leaf opens its file at the start of its range and keeps the focus in the tree", async () => {
        const { component, locate, click, sendKey, opened, positions } = await withTests();
        const { x, y } = locate("adds");
        click(x, y);
        opened.length = 0;
        positions.length = 0;
        sendKey("Enter");
        expect(opened).toEqual([FILE_URI]);
        expect(positions).toEqual([[3, 4]]);
        expect(component.tree.isFocused).toBe(true);
    });

    it("Enter on a test without a location toggles it", async () => {
        const { locate, click, sendKey, waitFrame, opened } = await withTests();
        const { x, y } = locate("src");
        click(x, y);
        await waitFrame((text) => !text.includes("math.test.ts"));
        sendKey("Enter");
        await waitFrame((text) => text.includes("math.test.ts"));
        expect(opened).toEqual([]);
    });

    it("the row under the cursor shows the Go to Test glyph one column off the right edge; none without a location", async () => {
        const { locate, click, lines, width } = await withTests();
        const { x, y } = locate("adds");
        click(x, y);
        const row = lines()[y];
        expect(row.at(width - 2)).toBe("↗");
        expect(row.at(width - 1)).toBe(" ");
        const src = locate("src");
        click(src.x, src.y);
        expect(lines()[src.y]).not.toContain("↗");
    });

    it("a click on the glyph goes to the test, the keyboard goes to the editor side", async () => {
        const { locate, click, lines, width, opened, positions } = await withTests();
        const { x, y } = locate("fails");
        click(x, y);
        expect(lines()[y].at(width - 2)).toBe("↗");
        opened.length = 0;
        positions.length = 0;
        click(width - 2, y);
        expect(opened).toEqual([FILE_URI]);
        expect(positions).toEqual([[6, 4]]);
    });

    it("Alt+Enter (testing.editFocusedTest) goes to the test under the cursor", async () => {
        const { views, locate, click, opened, positions } = await withTests();
        const { x, y } = locate("math.test.ts");
        click(x + 1, y);
        opened.length = 0;
        await views.commands.execute("testing.editFocusedTest");
        expect(opened).toEqual([FILE_URI]);
        expect(positions).toEqual([[0, 0]]);
    });
});

describe("TestingExplorerComponent — the row's context menu", () => {
    const UPDATE_SNAPSHOT = {
        menuId: MenuId.TestItem,
        command: "vitest.updateSnapshot",
        title: "Update Snapshot",
        when: "controllerId == 'vitest'",
    };

    it("an extension's item gets the row's test; built-in Go to Test is there for a test with a location", async () => {
        const { views, locate, click, mouse } = await withTests({ menus: [UPDATE_SNAPSHOT] });
        const seen: unknown[][] = [];
        views.commands.register("vitest.updateSnapshot", (...args: unknown[]) => {
            seen.push(args);
        });
        const { x, y } = locate("adds");
        click(x, y);
        mouse(x, y, "press", "right");
        mouse(x, y, "release", "right");
        const delegate = views.shown.at(-1);
        const entries = delegate?.getEntries?.() ?? [];
        const labels = entries.map((entry) => (entry.type === "separator" ? "-" : entry.label));
        expect(labels).toEqual(["Go to Test", "-", "Update Snapshot"]);
        const item = entries.find((entry) => entry.type !== "separator" && entry.label === "Update Snapshot");
        if (item === undefined || item.type === "separator" || item.type === "submenu") throw new Error("no item");
        item.onSelect?.();
        expect(seen).toEqual([[{ $testId: ADDS.join("\0") }]]);
    });

    it("a controller the item does not name does not get it; a test without a location has no Go to Test", async () => {
        const { views, tests, registerController, waitFrame, locate, component } = setupExplorer({
            menus: [UPDATE_SNAPSHOT],
        });
        registerController("go", "Go");
        tests.publishDiff([add(wireItem(["go"], "Go"), Expanded), add(wireItem(["go", "pkg"]), NotExpandable)]);
        await waitFrame((text) => text.includes("pkg"));
        const { x, y } = locate("pkg");
        component.tree.onContextMenu?.(component.tree.getSelectedNode() ?? { kind: "test", testId: "go\0pkg" }, x, y);
        expect(views.shown).toEqual([]);
    });

    it("a failing command is a toast", async () => {
        const { views, locate, click, mouse, toasts } = await withTests({ menus: [UPDATE_SNAPSHOT] });
        views.commands.register("vitest.updateSnapshot", () => Promise.reject(new Error("no snapshot")));
        const { x, y } = locate("adds");
        click(x, y);
        mouse(x, y, "press", "right");
        mouse(x, y, "release", "right");
        const item = views.shown
            .at(-1)
            ?.getEntries?.()
            .find((entry) => entry.type !== "separator" && entry.label === "Update Snapshot");
        if (item === undefined || item.type === "separator" || item.type === "submenu") throw new Error("no item");
        item.onSelect?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(toasts).toEqual(["no snapshot"]);
    });
});

describe("TestingExplorerComponent — the title", () => {
    it("Refresh Tests sits in the title while a controller can refresh, Cancel while it refreshes", async () => {
        const { tests, registerController, waitFrame, views } = setupExplorer();
        registerController("vitest", "Vitest", true);
        tests.publishDiff([...vitestRoot(), ...vitestFiles()]);
        await waitFrame((text) => text.includes("TEST EXPLORER") && text.includes("↻"));
        views.contextKeys.set("testing.isRefreshing", true);
        // `ViewTitleActionsContribution` does this on every key change in the app.
        views.service.refreshTitleActions();
        await waitFrame((text) => text.includes("■") && !text.includes("↻"));
    });

    it("Collapse All Tests collapses every expanded test", async () => {
        const { views, waitFrame } = await withTests();
        await views.commands.execute("testing.collapseAll");
        const frame = await waitFrame((text) => !text.includes("math.test.ts"));
        expect(frame).toContain("▸ ○ src");
    });

    it("the view is a section of the Testing container", async () => {
        const { views, registerController } = setupExplorer();
        registerController("vitest");
        await vi.waitFor(() => {
            expect(views.service.getViewContainerByViewId(TESTING_EXPLORER_VIEW_ID)).toBe(TESTING_VIEWLET_ID);
        });
    });
});
