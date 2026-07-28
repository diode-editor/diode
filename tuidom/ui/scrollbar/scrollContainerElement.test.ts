import { describe, expect, it } from "vitest";

import { expectScreen, screen } from "../../../src/TestUtils/expectScreen.ts";
import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { RenderContext } from "../../dom/tuiElement.ts";
import { TerminalScreen } from "../../rendering/terminalScreen.ts";
import { TextBlockElement } from "../text/textBlockElement.ts";

import { ScrollableElement, type ScrollViewportInfo } from "./scrollableElement.ts";
import { ScrollBarDecorator, unthemedScrollBarStyles } from "./scrollContainerElement.ts";
import { ScrollViewport } from "./scrollViewport.ts";

function createScrollContainer(
    screenWidth: number,
    screenHeight: number,
    contentLineCount: number,
): {
    container: ScrollBarDecorator;
    viewport: ScrollViewport;
    child: TextBlockElement;
    backend: MockTerminalBackend;
    termScreen: TerminalScreen;
} {
    const size = new Size(screenWidth, screenHeight);
    const backend = new MockTerminalBackend(size);
    const termScreen = new TerminalScreen(size);
    const child = new TextBlockElement(contentLineCount);
    const viewport = new ScrollViewport(child);
    const container = new ScrollBarDecorator(viewport);
    return { container, viewport, child, backend, termScreen };
}

function renderContainer(
    container: ScrollBarDecorator,
    termScreen: TerminalScreen,
    backend: MockTerminalBackend,
): MockTerminalBackend {
    container.layout(BoxConstraints.tight(termScreen.size));
    container.render(new RenderContext(termScreen));
    termScreen.flush(backend);
    return backend;
}

describe("ScrollBarDecorator", () => {
    it("allocates child width as container width minus 1 when content overflows", () => {
        const { container, child } = createScrollContainer(12, 5, 20);
        container.layout(BoxConstraints.tight(new Size(12, 5)));
        expect(child.layoutSize.width).toBe(11);
        expect(child.layoutSize.height).toBe(5);
    });

    it("allocates full width when content fits viewport", () => {
        const { container, child } = createScrollContainer(12, 5, 3);
        container.layout(BoxConstraints.tight(new Size(12, 5)));
        expect(child.layoutSize.width).toBe(12);
        expect(child.layoutSize.height).toBe(5);
    });

    it("renders content with scrollbar in last column at top", () => {
        const { container, backend, termScreen } = createScrollContainer(12, 5, 50);
        renderContainer(container, termScreen, backend);

        expectScreen(
            backend,
            screen`
                Line 001   █
                Line 002   ░
                Line 003   ░
                Line 004   ░
                Line 005   ░
            `,
        );
    });

    it("renders scrollbar at bottom when fully scrolled", () => {
        const { container, viewport, backend, termScreen } = createScrollContainer(12, 5, 50);
        viewport.scrollTop = 45; // scroll to bottom (50 - 5 = 45)
        renderContainer(container, termScreen, backend);

        expectScreen(
            backend,
            screen`
                Line 046   ░
                Line 047   ░
                Line 048   ░
                Line 049   ░
                Line 050   █
            `,
        );
    });

    it("hides scrollbar when content fits viewport (auto)", () => {
        const { container, backend, termScreen } = createScrollContainer(12, 5, 5);
        renderContainer(container, termScreen, backend);

        expectScreen(
            backend,
            screen`
                Line 001
                Line 002
                Line 003
                Line 004
                Line 005
            `,
        );
    });

    it("hides scrollbar when content smaller than viewport (auto)", () => {
        const { container, backend, termScreen } = createScrollContainer(12, 5, 3);
        renderContainer(container, termScreen, backend);

        expectScreen(
            backend,
            screen`
                Line 001
                Line 002
                Line 003
            `,
        );
    });

    it("shows thumb in middle when scrolled halfway", () => {
        const { container, viewport, backend, termScreen } = createScrollContainer(12, 10, 100);
        viewport.scrollTop = 45; // scroll to ~50%
        renderContainer(container, termScreen, backend);

        // With halves: 10 track height = 20 halves
        // thumbSize = max(2, round(10/100 * 20)) = 2 halves = 1 cell
        // maxScroll = 90, scrollFraction = 45/90 = 0.5
        // thumbStart = round(0.5 * (20 - 2)) = 9 halves
        // thumb at halves 9-10, i.e. bottom of cell 4 + top of cell 5
        const lines = backend.screenToString().split("\n");
        const lastCol = lines.map((l) => l[11]);
        // Track cells before and after thumb
        expect(lastCol[0]).toBe("░");
        expect(lastCol[9]).toBe("░");
        // Thumb should be around row 4-5
        expect(lastCol[4]).toBe("▄"); // bottom half
        expect(lastCol[5]).toBe("▀"); // top half
    });

    it("renders half-block characters for non-aligned thumb positions", () => {
        // 5 track height, 50 content, viewport 5 → 10 halves
        // thumbSize = max(2, round(5/50 * 10)) = 2 halves
        // scrollTop = 5: scrollFraction = 5/45 ≈ 0.111
        // thumbStart = round(0.111 * (10 - 2)) = round(0.888) = 1 half
        // → row 0: top half out, bottom half in → ▄
        // → row 1: top half in (half 2), bottom half out (half 3 >= 3) → ▀
        const { container, viewport, backend, termScreen } = createScrollContainer(12, 5, 50);
        viewport.scrollTop = 5;
        renderContainer(container, termScreen, backend);

        const lines = backend.screenToString().split("\n");
        const lastCol = lines.map((l) => l[11]);
        // Should contain half-block elements
        expect(lastCol.some((c) => "▀▄".includes(c))).toBe(true);
    });

    it("sets child localPosition to (0, 0)", () => {
        const { container, child } = createScrollContainer(12, 5, 50);

        container.layout(BoxConstraints.tight(new Size(12, 5)));

        expect(child.localPosition).toEqual(new Offset(0, 0));
    });

    it("sets child globalPosition based on container globalPosition", () => {
        const { container, child } = createScrollContainer(12, 5, 50);

        // Set container global position to (10, 20)
        container.localPosition = new Offset(10, 20);
        container.layout(BoxConstraints.tight(new Size(12, 5)));

        // Child should be at (10, 20)
        expect(child.globalPosition).toEqual(new Point(10, 20));
    });

    it("child markDirty propagates to container", () => {
        const { container, child } = createScrollContainer(12, 5, 50);

        container.layout(BoxConstraints.tight(new Size(12, 5)));
        expect(container.isLayoutDirty).toBe(false);

        child.markDirty();

        expect(container.isLayoutDirty).toBe(true);
    });

    it("child inherits container as parent after construction", () => {
        const { container, child } = createScrollContainer(12, 5, 50);

        // Verify by checking that child's markDirty affects container
        container.layout(BoxConstraints.tight(new Size(12, 5)));
        child.markDirty();

        expect(container.isLayoutDirty).toBe(true);
    });

    it("allocates child width as container width minus 1 while updating coordinates", () => {
        const { container, child } = createScrollContainer(12, 5, 50);
        container.layout(BoxConstraints.tight(new Size(12, 5)));

        // Child should have width=11 (12-1 for scrollbar) and height=5
        expect(child.layoutSize.width).toBe(11);
        expect(child.layoutSize.height).toBe(5);
        // And should have proper coordinates
        expect(child.localPosition).toEqual(new Offset(0, 0));
    });
});

class WideContentWidget extends ScrollableElement {
    private gridWidth: number;
    private gridHeight: number;

    public constructor(gridWidth: number, gridHeight: number) {
        super();
        this.gridWidth = gridWidth;
        this.gridHeight = gridHeight;
    }

    public get contentHeight(): number {
        return this.gridHeight;
    }

    public get contentWidth(): number {
        return this.gridWidth;
    }

    protected renderViewport(context: RenderContext, viewport: ScrollViewportInfo): void {
        for (let screenY = 0; screenY < viewport.viewportHeight; screenY++) {
            const contentY = viewport.scrollTop + screenY;
            if (contentY >= this.gridHeight) break;

            for (let screenX = 0; screenX < viewport.viewportWidth; screenX++) {
                const contentX = viewport.scrollLeft + screenX;
                if (contentX >= this.gridWidth) break;

                context.setCell(screenX, screenY, { char: String((contentX + contentY) % 10) });
            }
        }
    }
}

describe("ScrollBarDecorator vertical policy", () => {
    it("always: shows scrollbar even when content fits", () => {
        const size = new Size(12, 5);
        const backend = new MockTerminalBackend(size);
        const termScreen = new TerminalScreen(size);
        const child = new TextBlockElement(3);
        const viewport = new ScrollViewport(child);
        const container = new ScrollBarDecorator(viewport);
        container.verticalScrollBar = "always";

        container.layout(BoxConstraints.tight(size));
        container.render(new RenderContext(termScreen));
        termScreen.flush(backend);

        expectScreen(
            backend,
            screen`
                Line 001   █
                Line 002   █
                Line 003   █
                           █
                           █
            `,
        );
    });

    it("never: hides scrollbar even when content overflows", () => {
        const size = new Size(12, 5);
        const backend = new MockTerminalBackend(size);
        const termScreen = new TerminalScreen(size);
        const child = new TextBlockElement(50);
        const viewport = new ScrollViewport(child);
        const container = new ScrollBarDecorator(viewport);
        container.verticalScrollBar = "never";

        container.layout(BoxConstraints.tight(size));
        container.render(new RenderContext(termScreen));
        termScreen.flush(backend);

        // Child gets full width (12), no scrollbar column
        expectScreen(
            backend,
            screen`
                Line 001
                Line 002
                Line 003
                Line 004
                Line 005
            `,
        );
    });

    it("never: child gets full container width", () => {
        const size = new Size(12, 5);
        const child = new TextBlockElement(50);
        const viewport = new ScrollViewport(child);
        const container = new ScrollBarDecorator(viewport);
        container.verticalScrollBar = "never";

        container.layout(BoxConstraints.tight(size));

        expect(child.layoutSize.width).toBe(12);
    });
});

describe("ScrollBarDecorator horizontal scrollbar", () => {
    it("shows horizontal scrollbar when content is wider than viewport", () => {
        const size = new Size(10, 5);
        const backend = new MockTerminalBackend(size);
        const termScreen = new TerminalScreen(size);
        const widget = new WideContentWidget(30, 3);
        const container = new ScrollBarDecorator(widget);
        container.verticalScrollBar = "never";

        container.layout(BoxConstraints.tight(size));
        container.render(new RenderContext(termScreen));
        termScreen.flush(backend);

        // Last row should be horizontal scrollbar
        const lines = backend.screenToString().split("\n");
        expect(lines.length).toBe(5);
        // Content takes 4 rows (height - 1 for h-scrollbar), scrollbar on row 4.
        // "▄" (lower half block) keeps the bar on the widget's bottom edge.
        expect(lines[4]).toContain("▄");
    });

    it("hides horizontal scrollbar when content fits", () => {
        const size = new Size(10, 5);
        const backend = new MockTerminalBackend(size);
        const termScreen = new TerminalScreen(size);
        const widget = new WideContentWidget(5, 3);
        const container = new ScrollBarDecorator(widget);
        container.verticalScrollBar = "never";

        container.layout(BoxConstraints.tight(size));
        container.render(new RenderContext(termScreen));
        termScreen.flush(backend);

        // Child gets full height (5), no scrollbar row
        expect(widget.layoutSize.height).toBe(5);
    });

    it("horizontal never: child gets full height", () => {
        const size = new Size(10, 5);
        const widget = new WideContentWidget(30, 3);
        const container = new ScrollBarDecorator(widget);
        container.verticalScrollBar = "never";
        container.horizontalScrollBar = "never";

        container.layout(BoxConstraints.tight(size));

        expect(widget.layoutSize.height).toBe(5);
        expect(widget.layoutSize.width).toBe(10);
    });

    it("horizontal always: shows scrollbar even when content fits", () => {
        const size = new Size(10, 5);
        const widget = new WideContentWidget(5, 3);
        const container = new ScrollBarDecorator(widget);
        container.verticalScrollBar = "never";
        container.horizontalScrollBar = "always";

        container.layout(BoxConstraints.tight(size));

        expect(widget.layoutSize.height).toBe(4);
    });

    it("both scrollbars: child gets reduced size in both dimensions", () => {
        const size = new Size(10, 5);
        const widget = new WideContentWidget(30, 20);
        const container = new ScrollBarDecorator(widget);

        container.layout(BoxConstraints.tight(size));

        // auto: both overflows → both scrollbars visible
        // width - 1 for vertical scrollbar, height - 1 for horizontal scrollbar
        expect(widget.layoutSize.width).toBe(9);
        expect(widget.layoutSize.height).toBe(4);
    });
});

describe("ScrollBarDecorator setStyles", () => {
    it("renders the bar with the injected thumb/track/background colours", () => {
        const { container, termScreen, backend } = createScrollContainer(12, 5, 20);
        const styles = { thumb: packRgb(1, 2, 3), track: packRgb(4, 5, 6), background: packRgb(7, 8, 9) };
        container.setStyles(styles);

        renderContainer(container, termScreen, backend);

        // scrollTop = 0: thumb hugs the top of the track, the bottom row is track.
        expect(backend.getFgAt(new Point(11, 0))).toBe(styles.thumb);
        expect(backend.getFgAt(new Point(11, 4))).toBe(styles.track);
        expect(backend.getBgAt(new Point(11, 4))).toBe(styles.background);
    });

    it("uses the unthemed defaults until styles are injected", () => {
        const { container, termScreen, backend } = createScrollContainer(12, 5, 20);

        renderContainer(container, termScreen, backend);

        expect(backend.getFgAt(new Point(11, 0))).toBe(unthemedScrollBarStyles.thumb);
        expect(backend.getFgAt(new Point(11, 4))).toBe(unthemedScrollBarStyles.track);
    });
});
