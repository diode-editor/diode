import { describe, expect, it, vi } from "vitest";

import {
    add,
    setupExplorer,
    SwitchableIcons,
    THEME,
    update,
    wireItem,
} from "../../../../../TestUtils/testingExplorerHarness.ts";
import { testId } from "../../../../../TestUtils/testTree.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { SPINNER_FRAMES } from "../../../../platform/progress/common/progressService.ts";
import { TestItemExpandState, type WireTestsDiffOp } from "../../../api/common/testingWireTypes.ts";

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
        add(
            wireItem(ADDS, "adds", { uri: FILE_URI, range: createRange(3, 4, 5, 6), tags: [testId("vitest", "fast")] }),
            NotExpandable,
        ),
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
        const { views, locate, click, mouse, component } = await withTests({ menus: [UPDATE_SNAPSHOT] });
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
        expect(delegate?.getAnchor()).toEqual({
            screenX: expect.any(Number) as number,
            screenY: expect.any(Number) as number,
        });
        expect(delegate?.getOwner()).toBe(component.tree);
        const item = entries.find((entry) => entry.type !== "separator" && entry.label === "Update Snapshot");
        if (item === undefined || item.type === "separator" || item.type === "submenu") throw new Error("no item");
        item.onSelect?.();
        expect(seen).toEqual([[{ $testId: ADDS.join("\0") }]]);
    });

    it("a controller the item does not name does not get it; a test without a location has no Go to Test", async () => {
        const { views, tests, registerController, waitFrame, locate, click, component } = setupExplorer({
            menus: [UPDATE_SNAPSHOT],
        });
        registerController("go", "Go");
        tests.publishDiff([add(wireItem(["go"], "Go"), Expanded), add(wireItem(["go", "pkg"]), NotExpandable)]);
        await waitFrame((text) => text.includes("pkg"));
        const { x, y } = locate("pkg");
        click(x, y);
        const selected = component.tree.getSelectedNode();
        if (selected === null) throw new Error("no row");
        component.tree.onContextMenu?.(selected, x, y);
        expect(views.shown).toEqual([]);
    });

    it("a failing command is a toast", async () => {
        const { views, locate, click, mouse, toasts, toastOptions } = await withTests({ menus: [UPDATE_SNAPSHOT] });
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
        expect(toastOptions).toEqual([{ severity: "error", message: "no snapshot", modal: false, items: [] }]);
    });
});

describe("TestingExplorerComponent — the title", () => {
    it("Refresh Tests sits in the title while a controller can refresh, Cancel while it refreshes", async () => {
        const { tests, registerController, waitFrame, views } = setupExplorer();
        registerController("vitest", "Vitest", true);
        tests.publishDiff([...vitestRoot(), ...vitestFiles()]);
        await waitFrame((text) => text.includes("TEST EXPLORER") && text.includes("↻"));
        await views.commands.execute("testing.refreshTests");
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

describe("TestingExplorerComponent — the edges", () => {
    it("the root does not resolve before the view is built; building it does", async () => {
        const { tests, views, registerController, expands } = setupExplorer({ attach: false });
        registerController("vitest", "Vitest");
        tests.publishDiff(vitestRoot());
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(expands).toEqual([]);
        views.service.attachRegisteredContainers();
        await vi.waitFor(() => {
            expect(expands).toEqual([["vitest", 0]]);
        });
    });

    it("the only controller's error is the first row", async () => {
        const { tests, registerController, waitFrame, lines } = setupExplorer();
        registerController("vitest", "Vitest");
        tests.publishDiff([
            add(wireItem(ROOT, "Vitest", { error: "No vitest config" }), Expanded),
            add(wireItem(SRC), NotExpandable),
        ]);
        await waitFrame((text) => text.includes("No vitest config"));
        expect(lines()[3].trim()).toBe("No vitest config");
    });

    it("an error row neither opens nor has a menu", async () => {
        const { tests, component, views, waitFrame, opened } = await withTests();
        tests.publishDiff([update(ADDS, { error: "boom" })]);
        await waitFrame((text) => text.includes("boom"));
        const node = tests.getNodeById(ADDS.join("\0"));
        if (node === undefined) throw new Error("no adds");
        const row = { kind: "error", testId: ADDS.join("\0"), node } as const;
        component.tree.onActivate?.(row, { pinned: true, preserveFocus: false });
        component.tree.onContextMenu?.(row, 0, 0);
        expect(opened).toEqual([]);
        expect(views.shown).toEqual([]);
    });

    it("a glyph clicked after the menu lost its item does nothing", async () => {
        const { component, opened, locate, click } = await withTests();
        const { x, y } = locate("adds");
        click(x, y);
        opened.length = 0;
        const row = component.tree.getSelectedNode();
        if (row === null) throw new Error("no row");
        component.tree.onInlineAction?.(row, 5);
        expect(opened).toEqual([]);
    });

    it("Go to Test on a test without a location does nothing", async () => {
        const { views, row, click, opened } = await withTests();
        const { x, y } = row("src");
        click(x, y);
        opened.length = 0;
        await views.commands.execute("testing.editFocusedTest");
        expect(opened).toEqual([]);
    });

    it("a modified ArrowDown stays in the filter", async () => {
        const { component, sendKey } = await withTests();
        component.filterInput.focus();
        sendKey("Shift+ArrowDown");
        expect(component.filterInput.isFocused).toBe(true);
    });

    it("focusing the view puts the keyboard into the filter", async () => {
        const { views, component } = await withTests();
        views.focus(TESTING_VIEWLET_ID);
        expect(component.filterInput.isFocused).toBe(true);
    });

    it("the spinner turns on the shared clock", async () => {
        const { tests, waitFrame } = await withTests({ progress: { delayMs: 0, intervalMs: 5, minVisibleMs: 0 } });
        tests.publishDiff([update(ADDS, { busy: true })]);
        await waitFrame((text) => SPINNER_FRAMES.slice(1).some((spin) => text.includes(`${spin} adds`)));
    });

    it("switching the icon set redraws the state icons", async () => {
        const icons = new SwitchableIcons();
        const { waitFrame } = await withTests({ icons });
        icons.useNerdFont();
        await waitFrame((text) => !text.includes("○ adds"));
    });

    it("an item added to the row menu later shows its glyph; another menu's does not redraw", async () => {
        const { views, locate, click, waitFrame } = await withTests();
        views.commands.register("ext.run", () => undefined, "Run");
        const { x, y } = locate("adds");
        click(x, y);
        views.menuRegistry.appendMenuItem({ menuId: MenuId.EditorContext, command: "ext.run" });
        views.menuRegistry.appendMenuItem({ menuId: MenuId.TestItem, command: "ext.run", group: "inline", icon: "R" });
        await waitFrame((text) => text.split("\n")[y].includes("R"));
    });

    it("a key the row menu reads redraws the glyphs; other keys do not", async () => {
        const { views, locate, click, waitFrame } = await withTests({
            menus: [{ menuId: MenuId.TestItem, command: "ext.run", group: "inline", icon: "R", when: "ext.ready" }],
        });
        views.commands.register("ext.run", () => undefined, "Run");
        const { x, y } = locate("adds");
        click(x, y);
        views.contextKeys.set("searchViewletVisible", true);
        views.contextKeys.set("ext.ready" as never, true as never);
        await waitFrame((text) => text.split("\n")[y].includes("R"));
    });
});

/** Expands `label` (a row with a chevron) or collapses it: a click on its row. */
async function toggle(explorer: Awaited<ReturnType<typeof withTests>>, label: string): Promise<void> {
    const { x, y } = explorer.row(label);
    explorer.click(x, y);
    await Promise.resolve();
}

describe("TestingExplorerComponent — the details", () => {
    it("the frame's ids, the container's title and label, the sidebar's colors", async () => {
        const { component, views, locate, fgAt, bgAt, width } = await withTests();
        expect(component.tree.id).toBe("testingExplorerTree");
        expect(component.view.id).toBe("testingExplorerView");
        const container = views.service.getViewContainers().find((entry) => entry.id === TESTING_VIEWLET_ID);
        expect([container?.title, container?.label]).toEqual(["TESTING", "Testing"]);
        const summary = locate("No test results yet.");
        expect(fgAt(summary.x, summary.y)).toBe(THEME.getColor("sideBar.foreground"));
        expect(fgAt(width - 3, 1)).toBe(THEME.getColor("sideBar.foreground"));
        expect(bgAt(width - 3, 1)).toBe(THEME.getColor("sideBar.background"));
        expect(bgAt(2, 10)).toBe(THEME.getColor("sideBar.background"));
    });

    it("workbench.tree.expandMode: doubleClick — a click on a folder row only selects", async () => {
        const { tests, registerController, waitFrame, row, click, frame } = setupExplorer({
            settings: { "workbench.tree.expandMode": "doubleClick" },
        });
        registerController("vitest", "Vitest");
        tests.publishDiff([...vitestRoot(), ...vitestFiles()]);
        await waitFrame((text) => text.includes("src"));
        const src = row("src");
        click(src.x, src.y);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(frame()).not.toContain("math.test.ts");
    });

    it("workbench.list.openMode: a click opens a leaf, with doubleClick it only selects", async () => {
        const single = await withTests();
        single.opened.length = 0;
        const adds = single.locate("adds");
        single.click(adds.x, adds.y);
        expect(single.opened).toEqual([FILE_URI]);

        const double = await withTests({ settings: { "workbench.list.openMode": "doubleClick" } });
        double.opened.length = 0;
        const at = double.locate("adds");
        double.click(at.x, at.y);
        expect(double.opened).toEqual([]);
    });

    it("Collapse All leaves a test the user collapsed collapsed", async () => {
        const explorer = await withTests();
        await toggle(explorer, "math");
        await explorer.waitFrame((text) => !text.includes("adds"));
        await explorer.views.commands.execute("testing.collapseAll");
        await toggle(explorer, "src");
        await explorer.waitFrame((text) => text.includes("math.test.ts"));
        await toggle(explorer, "math.test.ts");
        await explorer.waitFrame((text) => text.includes(" math"));
        expect(explorer.frame()).not.toContain("adds");
    });

    it("a lazy test is asked once per expand: collapsing does not ask, expanding again does", async () => {
        const { tests, registerController, waitFrame, row, click, expands } = setupExplorer();
        registerController("vitest", "Vitest");
        tests.publishDiff([...vitestRoot(), ...vitestFiles()]);
        await waitFrame((text) => text.includes("src"));
        const src = row("src");
        click(src.x, src.y);
        await waitFrame((text) => text.includes("math.test.ts"));
        const file = row("math.test.ts");
        const asked = (): number => expands.filter(([id]) => id === FILE.join("\0")).length;
        click(file.x, file.y);
        await vi.waitFor(() => {
            expect(asked()).toBe(1);
        });
        click(file.x, file.y);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(asked()).toBe(1);
        click(file.x, file.y);
        await vi.waitFor(() => {
            expect(asked()).toBe(2);
        });
        // A folder vitest lists itself is not resolvable: expanding it asks nothing.
        expect(expands.map(([id]) => id)).not.toContain(SRC.join("\0"));
    });

    it("a modified ArrowUp on the first row stays in the tree; so does ArrowUp on an empty tree", async () => {
        const explorer = await withTests();
        const { component, sendKey } = explorer;
        const src = explorer.row("src");
        explorer.click(src.x, src.y);
        for (const key of ["Shift+ArrowUp", "Ctrl+ArrowUp", "Alt+ArrowUp"]) {
            sendKey(key);
            expect(component.tree.isFocused).toBe(true);
        }
        component.filterInput.inputState.value = "nothing";
        component.filterInput.onChange?.("nothing");
        await explorer.waitFrame((text) => !text.includes("src"));
        component.tree.focus();
        sendKey("ArrowUp");
        expect(component.tree.isFocused).toBe(true);
    });

    it("a modified ArrowDown stays in the filter", async () => {
        const { component, sendKey } = await withTests();
        component.filterInput.focus();
        for (const key of ["Ctrl+ArrowDown", "Alt+ArrowDown"]) {
            sendKey(key);
            expect(component.filterInput.isFocused).toBe(true);
        }
    });

    it("Escape on an empty filter is left to the workbench", async () => {
        const { component, sendKey } = await withTests();
        const prevented: boolean[] = [];
        component.view.addEventListener("keydown", (event) => {
            if (event.key === "Escape") prevented.push(event.defaultPrevented);
        });
        component.filterInput.focus();
        sendKey("Escape");
        sendKey("x");
        sendKey("Escape");
        expect(prevented).toEqual([false, true]);
    });

    it("disposing the view ends its progress", async () => {
        const { tests, component, progress, waitFrame } = await withTests();
        tests.publishDiff([update(ADDS, { busy: true })]);
        await waitFrame((text) => text.includes(`${SPINNER_FRAMES[0]} adds`));
        expect(progress.isBusy(TESTING_EXPLORER_VIEW_ID)).toBe(true);
        component.dispose();
        await Promise.resolve();
        expect(progress.isBusy(TESTING_EXPLORER_VIEW_ID)).toBe(false);
    });

    it("the view has a progress while a test deep in the tree is busy, and only then", async () => {
        const { tests, progress } = await withTests();
        expect(progress.isBusy(TESTING_EXPLORER_VIEW_ID)).toBe(false);
        tests.publishDiff([update(ADDS, { busy: true })]);
        await vi.waitFor(() => {
            expect(progress.isBusy(TESTING_EXPLORER_VIEW_ID)).toBe(true);
        });
    });

    it("an empty tree has no test under the cursor; an unknown test goes nowhere", async () => {
        const { component, opened, tests, registerController, waitFrame } = setupExplorer();
        registerController("vitest", "Vitest");
        tests.publishDiff([add(wireItem(ROOT, "Vitest"), Expanded)]);
        await waitFrame((text) => text.includes("No tests have been found"));
        expect(component.focusedTestId).toBeUndefined();
        component.goToTest("vitest\0gone", true);
        expect(opened).toEqual([]);
    });

    it("Go to Test keeps the keyboard where it is unless asked to come back to the tree", async () => {
        const { component } = await withTests();
        component.filterInput.focus();
        component.goToTest(ADDS.join("\0"), false);
        expect(component.filterInput.isFocused).toBe(true);
        component.goToTest(ADDS.join("\0"), true);
        expect(component.tree.isFocused).toBe(true);
    });

    it("a key that changes nothing about the controllers does not register the view again", async () => {
        const { views, registerController } = setupExplorer();
        registerController("vitest");
        await vi.waitFor(() => {
            expect(views.service.getViewContainerByViewId(TESTING_EXPLORER_VIEW_ID)).toBe(TESTING_VIEWLET_ID);
        });
        const registerView = vi.spyOn(views.service, "registerView");
        views.contextKeys.set("searchViewletVisible", true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(registerView).not.toHaveBeenCalled();
    });

    it("the view moves to the panel, as upstream's canMoveView", async () => {
        const { views, registerController } = setupExplorer();
        registerController("vitest");
        await vi.waitFor(() => {
            expect(views.service.getViewContainerByViewId(TESTING_EXPLORER_VIEW_ID)).toBe(TESTING_VIEWLET_ID);
        });
        views.service.moveViewToLocation(TESTING_EXPLORER_VIEW_ID, "panel");
        const container = views.service.getViewContainerByViewId(TESTING_EXPLORER_VIEW_ID);
        expect(container === null ? null : views.service.getViewContainerLocation(container)).toBe("panel");
    });

    it("a controller without tests next to one with them: no welcome, and the other's tests are the roots", async () => {
        const { tests, registerController, waitFrame, lines } = setupExplorer();
        registerController("vitest", "Vitest");
        registerController("go", "Go");
        tests.publishDiff([add(wireItem(["go"], "Go"), Expanded)]);
        tests.publishDiff([add(wireItem(ROOT, "Vitest"), Expanded), add(wireItem(SRC), NotExpandable)]);
        await waitFrame((text) => text.includes("src"));
        expect(lines()[3].trim()).toBe("○ src");
        expect(lines().join("\n")).not.toContain("Go");
    });

    it("a controller with an error and no tests is a root next to one with tests", async () => {
        const { tests, registerController, waitFrame } = setupExplorer();
        registerController("vitest", "Vitest");
        registerController("go", "Go");
        tests.publishDiff([add(wireItem(ROOT, "Vitest", { error: "No vitest config" }), Expanded)]);
        tests.publishDiff([add(wireItem(["go"], "Go"), Expanded), add(wireItem(["go", "pkg"]), NotExpandable)]);
        await waitFrame((text) => text.includes("No vitest config") && text.includes("Go") && text.includes("pkg"));
    });

    it("`!math` hides the matching tests with what is under them; a folder left with excluded tests only goes", async () => {
        const { component, waitFrame } = await withTests();
        component.filterInput.onChange?.("!math");
        const frame = await waitFrame((text) => !text.includes("math"));
        expect(frame).toContain("src");
        expect(frame).not.toContain("adds");
        // `adds` matches and is excluded by the later glob; nothing else matches.
        component.filterInput.onChange?.("adds, !adds");
        await waitFrame((text) => !text.includes("src"));
    });

    it("a test with an error stays visible under a filter that does not match it", async () => {
        const { tests, component, waitFrame } = await withTests();
        tests.publishDiff([update(SUITE, { error: "Cannot parse math" })]);
        await waitFrame((text) => text.includes("Cannot parse math"));
        component.filterInput.onChange?.("nothing");
        await waitFrame((text) => text.includes("Cannot parse math") && !text.includes("adds"));
    });

    it("clearing the filter expands nothing", async () => {
        const explorer = await withTests();
        await toggle(explorer, "math");
        await explorer.waitFrame((text) => !text.includes("adds"));
        explorer.component.filterInput.onChange?.("math");
        explorer.component.filterInput.onChange?.("");
        await new Promise((resolve) => setTimeout(resolve, 0));
        await explorer.waitFrame((text) => text.includes(" math"));
        expect(explorer.frame()).toContain("adds");
        await toggle(explorer, "math");
        await explorer.waitFrame((text) => !text.includes("adds"));
        explorer.component.filterInput.onChange?.("");
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(explorer.frame()).not.toContain("adds");
    });

    it("tags: `@vitest:fast` keeps the tagged test, `!@vitest:fast` drops it", async () => {
        const { component, waitFrame } = await withTests();
        component.filterInput.onChange?.("@vitest:fast");
        await waitFrame((text) => text.includes("adds") && !text.includes("fails"));
        component.filterInput.onChange?.("!@vitest:fast");
        await waitFrame((text) => !text.includes("adds") && text.includes("fails"));
    });

    it("a test with an error collapsed by the user stays collapsed; one that comes back expands again", async () => {
        const explorer = await withTests();
        const { tests, waitFrame } = explorer;
        tests.publishDiff([update(SUITE, { error: "Cannot parse math" })]);
        await waitFrame((text) => text.includes("Cannot parse math"));
        await toggle(explorer, "math");
        await waitFrame((text) => !text.includes("Cannot parse math"));
        tests.publishDiff([update(ADDS, { label: "adds two" })]);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(explorer.frame()).not.toContain("Cannot parse math");
        tests.publishDiff([{ op: 3, itemId: SUITE.join("\0") }]);
        await waitFrame((text) => !/○ math(\s|$)/m.test(text));
        tests.publishDiff([add(wireItem(SUITE, "math", { error: "Cannot parse math" }), NotExpandable)]);
        await waitFrame((text) => text.includes("Cannot parse math"));
    });

    it("an item of the row menu can name the test by its own id", async () => {
        const { views, locate, click, lines, width } = await withTests({
            menus: [
                { menuId: MenuId.TestItem, command: "ext.only", group: "inline", icon: "Q", when: "testId == 'adds'" },
            ],
        });
        views.commands.register("ext.only", () => undefined, "Only");
        const fails = locate("fails");
        click(fails.x, fails.y);
        expect(lines()[fails.y]).not.toContain("Q");
        const adds = locate("adds");
        click(adds.x, adds.y);
        expect(lines()[adds.y].slice(width - 6)).toContain("Q");
    });
});

describe("TestingExplorerComponent — keys, progress and the mirror", () => {
    it("Enter on a test with children and a location expands it and opens nothing", async () => {
        const explorer = await withTests();
        await toggle(explorer, "math.test.ts");
        await explorer.waitFrame((text) => !text.includes(" math\n") && !text.includes("adds"));
        explorer.opened.length = 0;
        explorer.sendKey("Enter");
        await explorer.waitFrame((text) => text.includes("adds"));
        expect(explorer.opened).toEqual([]);
    });

    it("a click on the glyph moves the keyboard out of the tree", async () => {
        const { component, locate, click, width } = await withTests();
        const { x, y } = locate("fails");
        click(x, y);
        click(width - 2, y);
        expect(component.tree.isFocused).toBe(false);
    });

    it("an inline action runs only the row's inline items, not its context menu", async () => {
        const { views, component, row, click } = await withTests({
            menus: [{ menuId: MenuId.TestItem, command: "ext.context", title: "Context" }],
        });
        const ran: unknown[] = [];
        views.commands.register("ext.context", (...args: unknown[]) => {
            ran.push(args);
        });
        const src = row("src");
        click(src.x, src.y);
        const selected = component.tree.getSelectedNode();
        if (selected === null) throw new Error("no row");
        component.tree.onInlineAction?.(selected, 0);
        expect(ran).toEqual([]);
    });

    it("on the first row only ArrowUp leaves the tree; the keys that leave do not go further", async () => {
        const explorer = await withTests();
        const { component, sendKey } = explorer;
        const prevented: string[] = [];
        component.view.addEventListener("keydown", (event) => {
            if (event.defaultPrevented) prevented.push(event.key);
        });
        const src = explorer.row("src");
        explorer.click(src.x, src.y);
        sendKey("ArrowDown");
        expect(component.tree.isFocused).toBe(true);
        sendKey("ArrowUp");
        sendKey("ArrowUp");
        expect(component.filterInput.isFocused).toBe(true);
        sendKey("ArrowDown");
        expect(component.tree.isFocused).toBe(true);
        expect(prevented.slice(-2)).toEqual(["ArrowUp", "ArrowDown"]);
    });

    it("ArrowUp on the first row of a folder goes to the folder, not to the filter", async () => {
        const explorer = await withTests();
        const adds = explorer.row("adds");
        explorer.click(adds.x, adds.y);
        explorer.sendKey("ArrowUp");
        expect(explorer.component.tree.isFocused).toBe(true);
        expect(explorer.component.focusedTestId).toBe(SUITE.join("\0"));
    });

    it("a controller that is there before the view is built has its view", () => {
        const { views } = setupExplorer({
            before: (tests) => {
                tests.registerTestController({
                    id: "vitest",
                    label: "Vitest",
                    canRefresh: false,
                    expandTest: () => Promise.resolve(),
                    refreshTests: () => Promise.resolve(),
                });
            },
        });
        expect(views.service.getViewContainerByViewId(TESTING_EXPLORER_VIEW_ID)).toBe(TESTING_VIEWLET_ID);
    });

    it("a controller that comes back without tests shows the welcome before its first diff", async () => {
        const { tests, registerController, waitFrame } = setupExplorer({ width: 60 });
        const first = registerController("vitest", "Vitest");
        tests.publishDiff([...vitestRoot(), ...vitestFiles()]);
        await waitFrame((text) => text.includes("src"));
        first.dispose();
        await vi.waitFor(() => {
            expect(tests.rootItems).toEqual([]);
        });
        registerController("go", "Go");
        await waitFrame((text) => text.includes("No tests have been found"));
    });

    it("a busy test of one controller out of two gives the view its progress, until it is idle again", async () => {
        const { tests, registerController, progress } = setupExplorer();
        registerController("vitest", "Vitest");
        registerController("go", "Go");
        tests.publishDiff([...vitestRoot(), add(wireItem(["go"], "Go"), Expanded)]);
        tests.publishDiff([update(["go"], { busy: true })]);
        await vi.waitFor(() => {
            expect(progress.isBusy(TESTING_EXPLORER_VIEW_ID)).toBe(true);
        });
        tests.publishDiff([update(["go"], { label: "Go!" })]);
        tests.publishDiff([update(["go"], { busy: false })]);
        await vi.waitFor(() => {
            expect(progress.isBusy(TESTING_EXPLORER_VIEW_ID)).toBe(false);
        });
    });

    it("a progress tick after the tests are idle does not redraw the tree", async () => {
        const { tests, component, progress, waitFrame } = await withTests();
        tests.publishDiff([update(ADDS, { busy: true })]);
        await waitFrame((text) => text.includes(`${SPINNER_FRAMES[0]} adds`));
        tests.publishDiff([update(ADDS, { busy: false })]);
        await waitFrame((text) => text.includes("○ adds"));
        const refresh = vi.spyOn(component.tree, "refresh");
        await progress.withProgress({ location: "view", viewId: "other", title: "Other" }, () => Promise.resolve());
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(refresh).not.toHaveBeenCalled();
    });

    it("spinner ticks redraw the rows without resolving the row menus again", async () => {
        const { tests, views, waitFrame } = await withTests({
            progress: { delayMs: 0, intervalMs: 5, minVisibleMs: 0 },
        });
        tests.publishDiff([update(ADDS, { busy: true })]);
        const spinning = (text: string): string | undefined =>
            SPINNER_FRAMES.slice(1).find((spin) => text.includes(`${spin} adds`));
        const first = spinning(await waitFrame((text) => spinning(text) !== undefined));
        const resolve = vi.spyOn(views.menuService, "getEntryGroups");
        await waitFrame((text) => spinning(text) !== undefined && spinning(text) !== first);
        expect(resolve).not.toHaveBeenCalled();
    });

    it("a test added under an active filter is filtered too", async () => {
        const { tests, component, waitFrame } = await withTests();
        component.filterInput.onChange?.("adds");
        await waitFrame((text) => !text.includes("fails"));
        tests.publishDiff([add(wireItem([...SUITE, "adds again"], "adds again"), NotExpandable)]);
        await waitFrame((text) => text.includes("adds again"));
    });

    it("the root is asked once while its controller has not answered", async () => {
        const { tests, views } = setupExplorer();
        const expands: string[] = [];
        tests.registerTestController({
            id: "vitest",
            label: "Vitest",
            canRefresh: false,
            expandTest: (id) => {
                expands.push(id);
                return new Promise(() => undefined);
            },
            refreshTests: () => Promise.resolve(),
        });
        tests.publishDiff(vitestRoot());
        await vi.waitFor(() => {
            expect(expands).toEqual(["vitest"]);
        });
        tests.publishDiff([update(ROOT, { label: "Vitest!" })]);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(expands).toEqual(["vitest"]);
        expect(views.viewlets).toContain(TESTING_VIEWLET_ID);
    });

    it("a leaf with an error has a chevron: its error is under it", async () => {
        const { tests, waitFrame, lines, row } = await withTests();
        tests.publishDiff([update(ADDS, { error: "boom" })]);
        await waitFrame((text) => text.includes("boom"));
        const adds = row("adds");
        const before = lines()[adds.y].slice(0, adds.x);
        const fails = row("fails");
        expect(before.trim()).not.toBe(lines()[fails.y].slice(0, fails.x).trim());
    });

    it("the error row is a row of its own: ArrowDown from it goes to the first child", async () => {
        const explorer = await withTests();
        explorer.tests.publishDiff([update(SUITE, { error: "Cannot parse math" })]);
        await explorer.waitFrame((text) => text.includes("Cannot parse math"));
        const { x, y } = explorer.locate("Cannot parse math");
        explorer.click(x, y);
        expect(explorer.component.tree.getSelectedNode()?.kind).toBe("error");
        explorer.sendKey("ArrowDown");
        expect(explorer.component.tree.getSelectedNode()?.kind).toBe("test");
        expect(explorer.component.focusedTestId).toBe(ADDS.join("\0"));
    });
});
