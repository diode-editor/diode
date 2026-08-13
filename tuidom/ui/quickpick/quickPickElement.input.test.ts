import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../testing/TestApp.ts";
import { Size } from "../../common/geometryPromitives.ts";

import type { QuickPickItem } from "./quickPickElement.ts";
import { QuickPickElement } from "./quickPickElement.ts";

// ─── Test helpers ────────────────────────────────────────────────────────────

function createApp(picker: QuickPickElement, size: Size = new Size(40, 14)): TestApp {
    const app = TestApp.createWithContent(picker, size);
    picker.focus();
    return app;
}

function makeItems(count: number, prefix = "item-"): QuickPickItem[] {
    return Array.from({ length: count }, (_, i) => ({
        label: `${prefix}${i + 1}`,
    }));
}

// ─── Selection navigation ────────────────────────────────────────────────────

describe("QuickPickElement — ArrowDown / ArrowUp navigation", () => {
    it("ArrowDown moves selection from 0 to 1", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(5);
        const app = createApp(picker);

        expect(picker.selectedIndex).toBe(0);
        app.sendKey("ArrowDown");
        expect(picker.selectedIndex).toBe(1);
    });

    it("multiple ArrowDown presses advance selection", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(5);
        const app = createApp(picker);

        app.sendKey("ArrowDown");
        app.sendKey("ArrowDown");
        app.sendKey("ArrowDown");
        expect(picker.selectedIndex).toBe(3);
    });

    it("fires onActiveItemChanged with the new item on navigation", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(5);
        const app = createApp(picker);
        const onActive = vi.fn();
        picker.onActiveItemChanged = onActive;

        app.sendKey("ArrowDown");
        expect(onActive).toHaveBeenCalledExactlyOnceWith({ label: "item-2" }, 1);
        app.sendKey("ArrowUp");
        expect(onActive).toHaveBeenLastCalledWith({ label: "item-1" }, 0);
    });

    it("does not fire onActiveItemChanged when the edge blocks movement", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(2);
        const app = createApp(picker);
        const onActive = vi.fn();
        picker.onActiveItemChanged = onActive;

        // Already at the top — ArrowUp is a no-op and must not notify.
        app.sendKey("ArrowUp");
        expect(onActive).not.toHaveBeenCalled();
    });

    it("setActiveIndex repositions the highlight without firing onActiveItemChanged", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(5);
        createApp(picker);
        const onActive = vi.fn();
        picker.onActiveItemChanged = onActive;

        picker.setActiveIndex(3);
        expect(picker.selectedIndex).toBe(3);
        expect(onActive).not.toHaveBeenCalled();

        // Out-of-range is clamped into bounds.
        picker.setActiveIndex(99);
        expect(picker.selectedIndex).toBe(4);
    });

    it("setActiveIndex is a no-op on an empty picker", () => {
        const picker = new QuickPickElement();
        picker.items = [];
        createApp(picker);

        // No items → nothing to highlight; must not throw or move the selection.
        expect(() => {
            picker.setActiveIndex(0);
        }).not.toThrow();
        expect(picker.selectedIndex).toBe(0);
    });

    it("ArrowDown does not go past last item (no wrap)", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(3);
        const app = createApp(picker);

        app.sendKey("ArrowDown");
        app.sendKey("ArrowDown");
        app.sendKey("ArrowDown"); // would be out of bounds if wrapping
        expect(picker.selectedIndex).toBe(2); // clamped at last
    });

    it("ArrowUp does not go below 0 (no wrap)", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(3);
        const app = createApp(picker);

        app.sendKey("ArrowUp"); // already at 0
        expect(picker.selectedIndex).toBe(0);
    });

    it("ArrowUp decrements selectedIndex", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(5);
        const app = createApp(picker);

        app.sendKey("ArrowDown");
        app.sendKey("ArrowDown");
        expect(picker.selectedIndex).toBe(2);
        app.sendKey("ArrowUp");
        expect(picker.selectedIndex).toBe(1);
    });

    it("navigation does nothing when items list is empty", () => {
        const picker = new QuickPickElement();
        picker.items = [];
        const app = createApp(picker);

        app.sendKey("ArrowDown");
        app.sendKey("ArrowUp");
        expect(picker.selectedIndex).toBe(0);
    });
});

// ─── PageDown / PageUp navigation ────────────────────────────────────────────

describe("QuickPickElement — PageDown / PageUp navigation", () => {
    it("PageDown moves the selection down by one visible page", () => {
        const picker = new QuickPickElement();
        picker.maxVisibleItems = 3;
        picker.items = makeItems(10);
        const app = createApp(picker, new Size(40, 7));

        app.sendKey("PageDown");
        expect(picker.selectedIndex).toBe(3);
        app.sendKey("PageDown");
        expect(picker.selectedIndex).toBe(6);
    });

    it("PageUp moves the selection back up by one visible page", () => {
        const picker = new QuickPickElement();
        picker.maxVisibleItems = 3;
        picker.items = makeItems(10);
        const app = createApp(picker, new Size(40, 7));

        app.sendKey("PageDown");
        app.sendKey("PageDown");
        expect(picker.selectedIndex).toBe(6);
        app.sendKey("PageUp");
        expect(picker.selectedIndex).toBe(3);
    });

    it("pages by the shorter list length when it is smaller than maxVisibleItems", () => {
        const picker = new QuickPickElement();
        picker.maxVisibleItems = 10;
        picker.items = makeItems(4);
        const app = createApp(picker);

        // A page is the visible row count (4), not maxVisibleItems (10) — the
        // clamp lands it on the last item either way, so check PageUp symmetry.
        app.sendKey("PageDown");
        expect(picker.selectedIndex).toBe(3);
        app.sendKey("PageUp");
        expect(picker.selectedIndex).toBe(0);
    });

    it("PageDown clamps at the last item (no wrap)", () => {
        const picker = new QuickPickElement();
        picker.maxVisibleItems = 3;
        picker.items = makeItems(5);
        const app = createApp(picker, new Size(40, 7));

        app.sendKey("PageDown"); // 0 → 3
        app.sendKey("PageDown"); // 3 → 6, clamped to 4
        expect(picker.selectedIndex).toBe(4);
        app.sendKey("PageDown"); // already at the end
        expect(picker.selectedIndex).toBe(4);
    });

    it("PageUp clamps at the first item (no wrap)", () => {
        const picker = new QuickPickElement();
        picker.maxVisibleItems = 3;
        picker.items = makeItems(5);
        const app = createApp(picker, new Size(40, 7));

        app.sendKey("PageUp"); // already at 0
        expect(picker.selectedIndex).toBe(0);
    });

    it("keeps the paged-to row visible", () => {
        const picker = new QuickPickElement();
        picker.maxVisibleItems = 3;
        picker.items = makeItems(10);
        const app = createApp(picker, new Size(40, 7));

        app.sendKey("PageDown");
        app.sendKey("PageDown");
        expect(picker.selectedIndex).toBe(6);

        app.render();
        expect(app.backend.screenToString()).toContain("item-7"); // index 6
    });

    it("fires onActiveItemChanged with the paged-to item", () => {
        const picker = new QuickPickElement();
        picker.maxVisibleItems = 3;
        picker.items = makeItems(10);
        const app = createApp(picker, new Size(40, 7));
        const onActive = vi.fn();
        picker.onActiveItemChanged = onActive;

        app.sendKey("PageDown");
        expect(onActive).toHaveBeenCalledExactlyOnceWith({ label: "item-4" }, 3);
    });

    it("paging does nothing when the items list is empty", () => {
        const picker = new QuickPickElement();
        picker.items = [];
        const app = createApp(picker);

        app.sendKey("PageDown");
        app.sendKey("PageUp");
        expect(picker.selectedIndex).toBe(0);
    });

    it("PageDown does not leak into the query input", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(10);
        const app = createApp(picker);

        app.sendKey("PageDown");
        expect(picker.getQuery()).toBe("");
    });
});

// ─── Scroll behaviour ────────────────────────────────────────────────────────

describe("QuickPickElement — scroll on navigation", () => {
    it("scrolls down when selection moves past the visible window", () => {
        const picker = new QuickPickElement();
        picker.maxVisibleItems = 3;
        picker.items = makeItems(10);
        const app = createApp(picker, new Size(40, 7)); // 4 + 3 = 7 rows high

        // Navigate down 4 times — item index 3 is outside the initial [0..2] window
        app.sendKey("ArrowDown");
        app.sendKey("ArrowDown");
        app.sendKey("ArrowDown");
        app.sendKey("ArrowDown");
        expect(picker.selectedIndex).toBe(4);
        // scrollOffset should have moved so index 4 is visible
        // We can't read scrollOffset directly, but we can verify the rendered text
        app.render();
        const text = app.backend.screenToString();
        expect(text).toContain("item-5"); // index 4 = "item-5"
    });

    it("scrolls up when selection moves above the visible window", () => {
        const picker = new QuickPickElement();
        picker.maxVisibleItems = 3;
        picker.items = makeItems(10);
        const app = createApp(picker, new Size(40, 7));

        // Go down past window, then back to index 0
        for (let i = 0; i < 6; i++) app.sendKey("ArrowDown");
        expect(picker.selectedIndex).toBe(6);
        for (let i = 0; i < 6; i++) app.sendKey("ArrowUp");
        expect(picker.selectedIndex).toBe(0);
        // Scrolled back to top; item-1 (index 0) should be visible
        app.render();
        const text = app.backend.screenToString();
        expect(text).toContain("item-1");
    });
});

// ─── Enter / onAccept ────────────────────────────────────────────────────────

describe("QuickPickElement — Enter / onAccept", () => {
    it("Enter calls onAccept with the currently selected item and index", () => {
        const picker = new QuickPickElement();
        const items = makeItems(3);
        picker.items = items;
        const onAccept = vi.fn();
        picker.onAccept = onAccept;
        const app = createApp(picker);

        app.sendKey("Enter");

        expect(onAccept).toHaveBeenCalledOnce();
        expect(onAccept).toHaveBeenCalledWith(items[0], 0);
    });

    it("Enter after ArrowDown calls onAccept with the moved-to item", () => {
        const picker = new QuickPickElement();
        const items = makeItems(3);
        picker.items = items;
        const onAccept = vi.fn();
        picker.onAccept = onAccept;
        const app = createApp(picker);

        app.sendKey("ArrowDown");
        app.sendKey("Enter");

        expect(onAccept).toHaveBeenCalledWith(items[1], 1);
    });

    it("Enter does not call onAccept when items list is empty", () => {
        const picker = new QuickPickElement();
        picker.items = [];
        const onAccept = vi.fn();
        picker.onAccept = onAccept;
        const app = createApp(picker);

        app.sendKey("Enter");

        expect(onAccept).not.toHaveBeenCalled();
    });
});

// ─── Escape / onCancel ───────────────────────────────────────────────────────

describe("QuickPickElement — Escape / onCancel", () => {
    it("Escape calls onCancel", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(3);
        const onCancel = vi.fn();
        picker.onCancel = onCancel;
        const app = createApp(picker);

        app.sendKey("Escape");

        expect(onCancel).toHaveBeenCalledOnce();
    });

    it("Escape does not call onAccept", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(3);
        const onAccept = vi.fn();
        const onCancel = vi.fn();
        picker.onAccept = onAccept;
        picker.onCancel = onCancel;
        const app = createApp(picker);

        app.sendKey("Escape");

        expect(onAccept).not.toHaveBeenCalled();
        expect(onCancel).toHaveBeenCalledOnce();
    });
});

// ─── Query / onQueryChange ────────────────────────────────────────────────────

describe("QuickPickElement — typing / onQueryChange", () => {
    it("typing characters calls onQueryChange with the new value", () => {
        const picker = new QuickPickElement();
        const onQueryChange = vi.fn();
        picker.onQueryChange = onQueryChange;
        const app = createApp(picker);

        app.sendKey("a");
        app.sendKey("p");
        app.sendKey("p");

        expect(onQueryChange).toHaveBeenCalledTimes(3);
        expect(onQueryChange).toHaveBeenLastCalledWith("app");
    });

    it("getQuery returns the current input value", () => {
        const picker = new QuickPickElement();
        const app = createApp(picker);

        app.sendKey("h");
        app.sendKey("i");

        expect(picker.getQuery()).toBe("hi");
    });

    it("setQuery updates the displayed text", () => {
        const picker = new QuickPickElement();
        createApp(picker);

        picker.setQuery("hello");
        expect(picker.getQuery()).toBe("hello");
    });

    it("Backspace removes the last typed character", () => {
        const picker = new QuickPickElement();
        const app = createApp(picker);

        app.sendKey("a");
        app.sendKey("b");
        app.sendKey("Backspace");

        expect(picker.getQuery()).toBe("a");
    });

    it("ArrowLeft / ArrowRight do not call onQueryChange", () => {
        const picker = new QuickPickElement();
        const onChange = vi.fn();
        picker.onQueryChange = onChange;
        const app = createApp(picker);

        app.sendKey("a");
        onChange.mockClear();

        app.sendKey("ArrowLeft");
        app.sendKey("ArrowRight");

        expect(onChange).not.toHaveBeenCalled();
    });

    it("typing does not change selectedIndex", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(5);
        const app = createApp(picker);

        app.sendKey("ArrowDown");
        expect(picker.selectedIndex).toBe(1);

        app.sendKey("a"); // typing should not reset selection
        expect(picker.selectedIndex).toBe(1);
    });
});

// ─── refreshItems (preserve selection across background refresh) ──────────────

describe("QuickPickElement — refreshItems preserves selection", () => {
    it("keeps the cursor on the same item when the list grows at the end", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(5);
        const app = createApp(picker);

        app.sendKey("ArrowDown");
        app.sendKey("ArrowDown");
        app.sendKey("ArrowDown");
        expect(picker.selectedIndex).toBe(3); // item-4

        // Background index grew: same results plus more appended.
        picker.refreshItems(makeItems(10));

        // Cursor must NOT snap back to the top.
        expect(picker.selectedIndex).toBe(3);
        expect(picker.items[picker.selectedIndex].label).toBe("item-4");
    });

    it("follows the selected item when it moves to a new index", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(3); // item-1, item-2, item-3
        const app = createApp(picker);

        app.sendKey("ArrowDown");
        app.sendKey("ArrowDown");
        expect(picker.items[picker.selectedIndex].label).toBe("item-3");

        // A higher-ranked result streamed in ahead of the selection.
        picker.refreshItems([{ label: "new-top" }, ...makeItems(3)]);

        // Still pointing at item-3, now shifted down by one.
        expect(picker.selectedIndex).toBe(3);
        expect(picker.items[picker.selectedIndex].label).toBe("item-3");
    });

    it("clamps to the new bounds when the selected item disappears", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(5);
        const app = createApp(picker);

        for (let i = 0; i < 4; i++) app.sendKey("ArrowDown");
        expect(picker.selectedIndex).toBe(4);

        // Results shrank and no longer contain the previously selected label.
        picker.refreshItems(makeItems(2, "other-"));

        expect(picker.selectedIndex).toBe(1); // clamped to last valid index
    });

    it("selects the first item when refreshed from an empty list", () => {
        const picker = new QuickPickElement();
        picker.items = [];
        createApp(picker);

        // No previously selected item to preserve → falls back to the top.
        picker.refreshItems(makeItems(3));
        expect(picker.selectedIndex).toBe(0);
    });

    it("resets to 0 when refreshed with an empty list", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(5);
        const app = createApp(picker);

        app.sendKey("ArrowDown");
        app.sendKey("ArrowDown");
        expect(picker.selectedIndex).toBe(2);

        picker.refreshItems([]);
        expect(picker.selectedIndex).toBe(0);
    });

    it("keeps the selected row visible after a refresh", () => {
        const picker = new QuickPickElement();
        picker.maxVisibleItems = 3;
        picker.items = makeItems(10);
        const app = createApp(picker, new Size(40, 7));

        for (let i = 0; i < 6; i++) app.sendKey("ArrowDown");
        expect(picker.selectedIndex).toBe(6); // item-7

        picker.refreshItems(makeItems(12));

        expect(picker.selectedIndex).toBe(6);
        app.render();
        expect(app.backend.screenToString()).toContain("item-7");
    });
});

// ─── Focus delegation ─────────────────────────────────────────────────────────

describe("QuickPickElement — focus", () => {
    it("focus() delegates to the inner InputElement", () => {
        const picker = new QuickPickElement();
        const app = TestApp.createWithContent(picker, new Size(40, 3));

        picker.focus();

        expect(app.focusedElement).toBe(picker.inputElement);
    });

    it("inner InputElement accepts typed characters after focus", () => {
        const picker = new QuickPickElement();
        const app = TestApp.createWithContent(picker, new Size(40, 3));
        picker.focus();

        app.sendKey("x");
        expect(picker.getQuery()).toBe("x");
    });
});
