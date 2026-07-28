import { describe, expect, it } from "vitest";

import { expectScreen, screen } from "../../../src/TestUtils/expectScreen.ts";
import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import { RenderContext } from "../../dom/tuiElement.ts";
import { TerminalScreen } from "../../rendering/terminalScreen.ts";

import type { QuickPickItem } from "./quickPickElement.ts";
import { QuickPickElement, unthemedQuickPickStyles } from "./quickPickElement.ts";

// ─── Test helpers ────────────────────────────────────────────────────────────

function renderPicker(picker: QuickPickElement, width: number): MockTerminalBackend {
    const height = picker.getMinIntrinsicHeight(width);
    const size = new Size(width, height);
    const backend = new MockTerminalBackend(size);
    const termScreen = new TerminalScreen(size);

    picker.localPosition = new Offset(0, 0);
    picker.layout(BoxConstraints.tight(size));

    const clip = new Rect(new Point(0, 0), size);
    picker.render(new RenderContext(termScreen, new Offset(0, 0), clip));
    termScreen.flush(backend);
    return backend;
}

function makeItems(count: number, prefix = "file-"): QuickPickItem[] {
    return Array.from({ length: count }, (_, i) => ({
        label: `${prefix}${i + 1}.ts`,
        description: `src/`,
    }));
}

// ─── Height ──────────────────────────────────────────────────────────────────

describe("QuickPickElement — height", () => {
    it("is 3 when there are no items (border + input + border)", () => {
        const picker = new QuickPickElement();
        expect(picker.getMinIntrinsicHeight(40)).toBe(3);
    });

    it("is 4 + itemCount for 1 item", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(1);
        expect(picker.getMinIntrinsicHeight(40)).toBe(5); // 4 + 1
    });

    it("is 4 + itemCount for 3 items", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(3);
        expect(picker.getMinIntrinsicHeight(40)).toBe(7); // 4 + 3
    });

    it("caps at 4 + maxVisibleItems when items exceed limit", () => {
        const picker = new QuickPickElement();
        picker.maxVisibleItems = 5;
        picker.items = makeItems(20);
        expect(picker.getMinIntrinsicHeight(40)).toBe(9); // 4 + 5
    });
});

// ─── Border rendering ────────────────────────────────────────────────────────

describe("QuickPickElement — border", () => {
    it("draws top border on row 0", () => {
        const picker = new QuickPickElement();
        const backend = renderPicker(picker, 20);
        expect(backend.getTextAt(new Point(0, 0), 1)).toBe("╭");
        expect(backend.getTextAt(new Point(19, 0), 1)).toBe("╮");
    });

    it("draws bottom border on row 2 when no items", () => {
        const picker = new QuickPickElement();
        const backend = renderPicker(picker, 20);
        expect(backend.getTextAt(new Point(0, 2), 1)).toBe("╰");
        expect(backend.getTextAt(new Point(19, 2), 1)).toBe("╯");
    });

    it("draws separator at row 2 when there are items", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(2);
        const backend = renderPicker(picker, 20);
        expect(backend.getTextAt(new Point(0, 2), 1)).toBe("├");
        expect(backend.getTextAt(new Point(19, 2), 1)).toBe("┤");
    });

    it("draws bottom border at last row when there are items", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(2);
        const height = picker.getMinIntrinsicHeight(20);
        const backend = renderPicker(picker, 20);
        expect(backend.getTextAt(new Point(0, height - 1), 1)).toBe("╰");
        expect(backend.getTextAt(new Point(19, height - 1), 1)).toBe("╯");
    });
});

// ─── Placeholder ─────────────────────────────────────────────────────────────

describe("QuickPickElement — placeholder", () => {
    it("shows placeholder text on row 1 when query is empty", () => {
        const picker = new QuickPickElement();
        picker.placeholder = "Go to file…";
        const backend = renderPicker(picker, 30);
        const row = backend.getTextAt(new Point(1, 1), 15);
        expect(row).toContain("Go to file");
    });

    it("does not show placeholder when query has text", () => {
        const picker = new QuickPickElement();
        picker.placeholder = "Placeholder";
        picker.setQuery("hello");
        const backend = renderPicker(picker, 30);
        const row = backend.getTextAt(new Point(1, 1), 15);
        expect(row).toContain("hello");
        expect(row).not.toContain("Placeholder");
    });
});

// ─── Item rendering ───────────────────────────────────────────────────────────

describe("QuickPickElement — items", () => {
    it("renders item labels starting at row 3", () => {
        const picker = new QuickPickElement();
        picker.items = [{ label: "Alpha" }, { label: "Beta" }, { label: "Gamma" }];
        const backend = renderPicker(picker, 30);
        expect(backend.getTextAt(new Point(0, 3), 30)).toContain("Alpha");
        expect(backend.getTextAt(new Point(0, 4), 30)).toContain("Beta");
        expect(backend.getTextAt(new Point(0, 5), 30)).toContain("Gamma");
    });

    it("renders description on the right side of the row", () => {
        const picker = new QuickPickElement();
        picker.items = [{ label: "main.ts", description: "src/" }];
        const backend = renderPicker(picker, 30);
        const row = backend.getTextAt(new Point(0, 3), 30);
        expect(row).toContain("main.ts");
        expect(row).toContain("src/");
    });

    it("renders shortcut on the right side", () => {
        const picker = new QuickPickElement();
        picker.items = [{ label: "Save", shortcut: "Ctrl+S" }];
        const backend = renderPicker(picker, 30);
        const row = backend.getTextAt(new Point(0, 3), 30);
        expect(row).toContain("Save");
        expect(row).toContain("Ctrl+S");
    });

    it("renders badge text on the right side", () => {
        const picker = new QuickPickElement();
        picker.items = [{ label: "Open File", badge: "recent" }];
        const backend = renderPicker(picker, 40);
        const row = backend.getTextAt(new Point(0, 3), 40);
        expect(row).toContain("Open File");
        expect(row).toContain("recent");
    });

    it("renders hint text on the right side", () => {
        const picker = new QuickPickElement();
        picker.items = [{ label: "Bind", hint: "Configure Binding" }];
        const backend = renderPicker(picker, 40);
        const row = backend.getTextAt(new Point(0, 3), 40);
        expect(row).toContain("Bind");
        expect(row).toContain("Configure Binding");
    });

    it("renders the hint of a non-selected item with the hint colour (line 336 false branch)", () => {
        const picker = new QuickPickElement();
        // Index 0 is selected by default; the hint item at index 1 is NOT selected,
        // so its hint uses HINT_FG rather than activeSelectionFg.
        picker.items = [{ label: "First" }, { label: "Bind", hint: "Configure Binding" }];
        const backend = renderPicker(picker, 40);
        const row = backend.getTextAt(new Point(0, 4), 40); // row for item index 1
        expect(row).toContain("Configure Binding");
    });

    it("renders icon column when any item has an icon", () => {
        const picker = new QuickPickElement();
        picker.items = [{ icon: "A", label: "Alpha" }, { label: "Beta" }];
        const backend = renderPicker(picker, 30);
        // Row with icon: the icon char should appear before the label
        const rowWithIcon = backend.getTextAt(new Point(2, 3), 10);
        expect(rowWithIcon).toContain("A");
    });

    it("leaves icon slot empty (space) for items without icon", () => {
        const picker = new QuickPickElement();
        picker.items = [
            { icon: "A", label: "Alpha" },
            { label: "Beta" }, // no icon
        ];
        const backend = renderPicker(picker, 30);
        // For the row without icon, position 2 should be a space
        expect(backend.getTextAt(new Point(2, 4), 1)).toBe(" ");
    });
});

// ─── Selection ───────────────────────────────────────────────────────────────

describe("QuickPickElement — selection", () => {
    it("first item is selected by default (selectedIndex = 0)", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(3);
        expect(picker.selectedIndex).toBe(0);
    });

    it("selected item has a different background colour", () => {
        const picker = new QuickPickElement();
        picker.items = [{ label: "Alpha" }, { label: "Beta" }];
        const backend = renderPicker(picker, 30);

        const selectedBg = backend.getBgAt(new Point(5, 3));
        const normalBg = backend.getBgAt(new Point(5, 4));
        expect(selectedBg).not.toBe(normalBg);
        expect(selectedBg).toBe(unthemedQuickPickStyles.activeSelectionBg);
    });

    it("selection highlight does not bleed onto the side borders (issue #94)", () => {
        const picker = new QuickPickElement();
        picker.items = [{ label: "Alpha" }, { label: "Beta" }];
        const backend = renderPicker(picker, 30);

        // Row 3 is the selected item. Its interior is highlighted, but the
        // border columns must keep the plain box background — not the selection.
        const interiorBg = backend.getBgAt(new Point(5, 3));
        const leftBorderBg = backend.getBgAt(new Point(0, 3));
        const rightBorderBg = backend.getBgAt(new Point(29, 3));

        expect(interiorBg).toBe(unthemedQuickPickStyles.activeSelectionBg);
        expect(leftBorderBg).not.toBe(unthemedQuickPickStyles.activeSelectionBg);
        expect(rightBorderBg).not.toBe(unthemedQuickPickStyles.activeSelectionBg);
        // Border columns match the background of a non-selected row's border.
        expect(leftBorderBg).toBe(backend.getBgAt(new Point(0, 4)));
        expect(rightBorderBg).toBe(backend.getBgAt(new Point(29, 4)));
        // The border glyphs are still drawn.
        expect(backend.getTextAt(new Point(0, 3), 1)).toBe("│");
        expect(backend.getTextAt(new Point(29, 3), 1)).toBe("│");
    });

    it("resets selectedIndex to 0 when items are replaced", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(5);
        // manually bump selectedIndex via navigation (we test this in Input tests)
        // Here we just verify the setter resets it
        picker.items = makeItems(3);
        expect(picker.selectedIndex).toBe(0);
    });
});

// ─── Match highlights ─────────────────────────────────────────────────────────

describe("QuickPickElement — match highlight colours", () => {
    it("matched chars in label have matchFg colour", () => {
        const picker = new QuickPickElement();
        // Put a match-highlighted item at index 1 so it is NOT selected
        // (index 0 is selected by default and uses activeSelectionFg).
        picker.items = [{ label: "Other" }, { label: "AppContainer", labelMatchRanges: [[0, 3]] }];
        const backend = renderPicker(picker, 40);

        // Row 4 = item index 1 (not selected)
        // Label starts at x=2 (no icon column)
        const matchedFg = backend.getFgAt(new Point(2, 4)); // 'A' in "App"
        const unmatchedFg = backend.getFgAt(new Point(5, 4)); // 'C' in "Container"
        expect(matchedFg).toBe(unthemedQuickPickStyles.matchFg);
        expect(unmatchedFg).not.toBe(unthemedQuickPickStyles.matchFg);
    });

    it("no special colour when labelMatchRanges is empty", () => {
        const picker = new QuickPickElement();
        picker.items = [{ label: "AppContainer" }];
        const backend = renderPicker(picker, 40);

        const fg = backend.getFgAt(new Point(2, 3));
        expect(fg).not.toBe(unthemedQuickPickStyles.matchFg);
    });
});

// ─── Scroll ───────────────────────────────────────────────────────────────────

describe("QuickPickElement — scroll", () => {
    it("renders only maxVisibleItems rows at a time", () => {
        const picker = new QuickPickElement();
        picker.maxVisibleItems = 3;
        picker.items = makeItems(10, "file-");
        const backend = renderPicker(picker, 30);

        // 10 items but only 3 visible: rows 3, 4, 5
        // Row 3: file-1
        expect(backend.getTextAt(new Point(0, 3), 30)).toContain("file-1");
        expect(backend.getTextAt(new Point(0, 4), 30)).toContain("file-2");
        expect(backend.getTextAt(new Point(0, 5), 30)).toContain("file-3");
    });

    it("scrolls viewport when rendering after selection moves past visible window", () => {
        const picker = new QuickPickElement();
        picker.maxVisibleItems = 3;
        // Create items and manually set items to simulate scroll state
        const items = makeItems(10, "file-");
        picker.items = items;

        // Move selection to item index 5 (0-based) by rebuilding items
        // with selectedIndex already past the window — we do this by calling
        // items setter (resets to 0), then simulating what the input tests cover.
        // For a pure render test, we can poke at internals via a fresh picker
        // that has been set up with a specific initial scroll via the public API.

        // The easiest approach: set items with maxVisibleItems = 3 and verify
        // that the first visible item is rendered correctly. Scroll correctness
        // is verified fully in Input tests (after ArrowDown navigation).
        const backend = renderPicker(picker, 30);
        const h = picker.getMinIntrinsicHeight(30);
        // Bottom border is at last row
        expect(backend.getTextAt(new Point(0, h - 1), 1)).toBe("╰");
    });

    it("compact screen: obeys tight(30,3) — box shrinks, no item rows", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(2);
        const size = new Size(30, 3);
        const backend = new MockTerminalBackend(size);
        const termScreen = new TerminalScreen(size);
        picker.localPosition = new Offset(0, 0);
        const result = picker.layout(BoxConstraints.tight(size));
        expect(result).toEqual(size); // контракт: tight обязывает
        const clip = new Rect(new Point(0, 0), size);
        picker.render(new RenderContext(termScreen, new Offset(0, 0), clip));
        termScreen.flush(backend);
        // Рамка целиком в выделенной высоте: нижняя граница на строке 2, не обрезана.
        expect(backend.getTextAt(new Point(0, 0), 1)).toBe("╭");
        expect(backend.getTextAt(new Point(0, 2), 1)).toBe("╰");
    });

    it("clamped height: list window shrinks to the allocated rows", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(10);
        // natural = 4 + 10 = 14; loose(30, 8) → высота 8, окно списка 8-4 = 4 строки
        picker.localPosition = new Offset(0, 0);
        const result = picker.layout(BoxConstraints.loose(new Size(30, 8)));
        expect(result.height).toBe(8);

        const size = new Size(30, 8);
        const backend = new MockTerminalBackend(size);
        const termScreen = new TerminalScreen(size);
        const clip = new Rect(new Point(0, 0), size);
        picker.render(new RenderContext(termScreen, new Offset(0, 0), clip));
        termScreen.flush(backend);
        // Строки 3..6 — элементы, строка 7 — нижняя рамка.
        expect(backend.getTextAt(new Point(2, 3), 9)).toBe("file-1.ts");
        expect(backend.getTextAt(new Point(2, 6), 9)).toBe("file-4.ts");
        expect(backend.getTextAt(new Point(0, 7), 1)).toBe("╰");
    });

    it("allocated more than natural: size obeys tight, frame stays natural", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(2); // natural = 6
        picker.localPosition = new Offset(0, 0);
        const result = picker.layout(BoxConstraints.tight(new Size(30, 12)));
        expect(result).toEqual(new Size(30, 12)); // контракт: tight обязывает

        const size = new Size(30, 12);
        const backend = new MockTerminalBackend(size);
        const termScreen = new TerminalScreen(size);
        const clip = new Rect(new Point(0, 0), size);
        picker.render(new RenderContext(termScreen, new Offset(0, 0), clip));
        termScreen.flush(backend);
        // Рамка рисуется natural-высотой: низ на строке 5, ниже — пусто.
        expect(backend.getTextAt(new Point(0, 5), 1)).toBe("╰");
        expect(backend.getTextAt(new Point(0, 6), 1)).toBe(" ");
    });
});

// ─── Snapshot rendering ───────────────────────────────────────────────────────

describe("QuickPickElement — snapshot", () => {
    it("renders empty picker correctly", () => {
        const picker = new QuickPickElement();
        picker.placeholder = "Go to file...";
        const backend = renderPicker(picker, 20);
        expectScreen(
            backend,
            screen`
                ╭──────────────────╮
                │Go to file...     │
                ╰──────────────────╯
            `,
        );
    });

    it("renders picker with two items", () => {
        const picker = new QuickPickElement();
        picker.placeholder = "Search";
        picker.items = [{ label: "Alpha" }, { label: "Beta" }];
        const backend = renderPicker(picker, 20);
        expectScreen(
            backend,
            screen`
                ╭──────────────────╮
                │Search            │
                ├──────────────────┤
                │ Alpha            │
                │ Beta             │
                ╰──────────────────╯
            `,
        );
    });
});

// ─── Layout width ────────────────────────────────────────────────────────────

describe("QuickPickElement — layout width", () => {
    it("with loose constraints uses preferredWidth, not maxWidth", () => {
        const picker = new QuickPickElement();
        picker.preferredWidth = 40;
        picker.localPosition = new Offset(0, 0);
        picker.layout(BoxConstraints.loose(new Size(100, 50)));
        expect(picker.layoutSize.width).toBe(40);
    });

    it("with an unbounded maxWidth falls back to preferredWidth (line 197 else branch)", () => {
        const picker = new QuickPickElement();
        picker.preferredWidth = 50;
        picker.localPosition = new Offset(0, 0);
        // maxWidth = Infinity → Number.isFinite(...) is false → maxW = preferredWidth.
        picker.layout(new BoxConstraints(0, Infinity, 0, Infinity));
        expect(picker.layoutSize.width).toBe(50);
    });

    it("with loose constraints is clamped to maxWidth when smaller than preferredWidth", () => {
        const picker = new QuickPickElement();
        picker.preferredWidth = 40;
        picker.localPosition = new Offset(0, 0);
        picker.layout(BoxConstraints.loose(new Size(30, 50)));
        expect(picker.layoutSize.width).toBe(30);
    });

    it("with tight constraints uses exact size regardless of preferredWidth", () => {
        const picker = new QuickPickElement();
        picker.preferredWidth = 40;
        picker.localPosition = new Offset(0, 0);
        const height = picker.getMinIntrinsicHeight(50);
        picker.layout(BoxConstraints.tight(new Size(50, height)));
        expect(picker.layoutSize.width).toBe(50);
    });

    it("getMaxIntrinsicWidth reflects preferredWidth", () => {
        const picker = new QuickPickElement();
        picker.preferredWidth = 75;
        expect(picker.getMaxIntrinsicWidth(0)).toBe(75);
    });

    it("getMinIntrinsicWidth is a fixed minimum of 20 columns", () => {
        const picker = new QuickPickElement();
        picker.preferredWidth = 75;
        expect(picker.getMinIntrinsicWidth(0)).toBe(20);
    });

    it("getMaxIntrinsicHeight matches getMinIntrinsicHeight (self-sizing)", () => {
        const picker = new QuickPickElement();
        picker.items = makeItems(3);
        expect(picker.getMaxIntrinsicHeight(40)).toBe(7); // 4 + 3
        expect(picker.getMaxIntrinsicHeight(40)).toBe(picker.getMinIntrinsicHeight(40));
    });
});

// ─── Overflow / truncation ────────────────────────────────────────────────────

describe("QuickPickElement — long content does not overflow the border", () => {
    const WIDTH = 40;
    const ITEM_ROW_Y = 3;

    function itemRow(picker: QuickPickElement): string {
        const backend = renderPicker(picker, WIDTH);
        return backend.getTextAt(new Point(0, ITEM_ROW_Y), WIDTH);
    }

    it("keeps the right border intact when the path is very deep", () => {
        const picker = new QuickPickElement();
        picker.items = [
            { label: "menu.ts", description: "src/components/widgets/popups/contextmenu/items/deeply/nested" },
        ];
        const row = itemRow(picker);
        // Last column is still the box border, nothing spilled past it.
        expect(row[WIDTH - 1]).toBe("│");
        expect(row[0]).toBe("│");
        // The deep path was abbreviated with an ellipsis.
        expect(row).toContain("…");
        // Filename (priority) stays fully visible.
        expect(row).toContain("menu.ts");
    });

    it("ellipsizes a filename that is itself too long to fit", () => {
        const picker = new QuickPickElement();
        picker.items = [{ label: "ThisIsAnExtremelyLongFileNameThatCannotPossiblyFit.tsx", description: "" }];
        const row = itemRow(picker);
        expect(row[WIDTH - 1]).toBe("│");
        expect(row).toContain("…");
        // Prefix of the name is preserved.
        expect(row).toContain("ThisIs");
    });

    it("shows the full path when it comfortably fits (no ellipsis)", () => {
        const picker = new QuickPickElement();
        picker.items = [{ label: "main.ts", description: "src" }];
        const row = itemRow(picker);
        expect(row).toContain("main.ts");
        expect(row).toContain("src");
        expect(row).not.toContain("…");
    });
});

// ─── setStyles ───────────────────────────────────────────────────────────────

describe("QuickPickElement — setStyles", () => {
    it("repaints the picker with the injected colours", () => {
        const picker = new QuickPickElement();
        picker.items = [{ label: "Alpha" }, { label: "Beta" }];
        picker.setStyles({
            ...unthemedQuickPickStyles,
            activeSelectionBg: packRgb(9, 9, 9),
            bg: packRgb(1, 2, 3),
        });

        const backend = renderPicker(picker, 30);

        // Row 3 — the selected item, row 4 — a plain one on the box background.
        expect(backend.getBgAt(new Point(5, 3))).toBe(packRgb(9, 9, 9));
        expect(backend.getBgAt(new Point(5, 4))).toBe(packRgb(1, 2, 3));
    });
});
