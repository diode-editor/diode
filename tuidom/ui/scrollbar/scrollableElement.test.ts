import { describe, expect, it } from "vitest";

import { expectScreen, screen } from "../../testing/expectScreen.ts";
import { renderElement } from "../../testing/renderElement.ts";
import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { RenderContext } from "../../dom/tuiElement.ts";
import { TerminalScreen } from "../../rendering/terminalScreen.ts";

import { ScrollableElement, type ScrollViewportInfo } from "./scrollableElement.ts";

class LargeGridWidget extends ScrollableElement {
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

                const char = String((contentX + contentY) % 10);
                context.setCell(screenX, screenY, { char });
            }
        }
    }
}

function createGrid(
    screenWidth: number,
    screenHeight: number,
    gridWidth: number,
    gridHeight: number,
): {
    widget: LargeGridWidget;
    termScreen: TerminalScreen;
} {
    const size = new Size(screenWidth, screenHeight);
    const termScreen = new TerminalScreen(size);
    const widget = new LargeGridWidget(gridWidth, gridHeight);
    return { widget, termScreen };
}

describe("ScrollableElement", () => {
    describe("intrinsic sizing", () => {
        it("reports zero minimum and content-sized maximum on both axes", () => {
            const { widget } = createGrid(5, 3, 20, 10);
            expect(widget.getMinIntrinsicWidth(0)).toBe(0);
            expect(widget.getMaxIntrinsicWidth(0)).toBe(20);
            expect(widget.getMinIntrinsicHeight(0)).toBe(0);
            expect(widget.getMaxIntrinsicHeight(0)).toBe(10);
        });
    });

    describe("scrollTo", () => {
        it("clamps scrollTop to valid range", () => {
            const { widget, termScreen } = createGrid(5, 3, 20, 10);
            widget.localPosition = new Offset(0, 0);
            widget.layout(BoxConstraints.tight(termScreen.size));

            widget.scrollTo(0, -5);
            expect(widget.scrollTop).toBe(0);

            widget.scrollTo(0, 100);
            expect(widget.scrollTop).toBe(7); // 10 - 3 = 7

            widget.scrollTo(0, 5);
            expect(widget.scrollTop).toBe(5);
        });

        it("clamps scrollLeft to valid range", () => {
            const { widget, termScreen } = createGrid(5, 3, 20, 10);
            widget.localPosition = new Offset(0, 0);
            widget.layout(BoxConstraints.tight(termScreen.size));

            widget.scrollTo(-5, 0);
            expect(widget.scrollLeft).toBe(0);

            widget.scrollTo(100, 0);
            expect(widget.scrollLeft).toBe(15); // 20 - 5 = 15

            widget.scrollTo(10, 0);
            expect(widget.scrollLeft).toBe(10);
        });

        it("clamps both axes at once", () => {
            const { widget, termScreen } = createGrid(5, 3, 20, 10);
            widget.localPosition = new Offset(0, 0);
            widget.layout(BoxConstraints.tight(termScreen.size));

            widget.scrollTo(100, 100);
            expect(widget.scrollLeft).toBe(15);
            expect(widget.scrollTop).toBe(7);
        });

        it("allows zero when content fits viewport", () => {
            const { widget, termScreen } = createGrid(10, 10, 5, 3);
            widget.localPosition = new Offset(0, 0);
            widget.layout(BoxConstraints.tight(termScreen.size));

            widget.scrollTo(5, 5);
            expect(widget.scrollLeft).toBe(0);
            expect(widget.scrollTop).toBe(0);
        });
    });

    describe("scrollBy", () => {
        it("scrolls relative to current position", () => {
            const { widget, termScreen } = createGrid(5, 3, 20, 10);
            widget.localPosition = new Offset(0, 0);
            widget.layout(BoxConstraints.tight(termScreen.size));

            widget.scrollBy(3, 2);
            expect(widget.scrollLeft).toBe(3);
            expect(widget.scrollTop).toBe(2);

            widget.scrollBy(1, 1);
            expect(widget.scrollLeft).toBe(4);
            expect(widget.scrollTop).toBe(3);
        });

        it("clamps when scrolling beyond bounds", () => {
            const { widget, termScreen } = createGrid(5, 3, 20, 10);
            widget.localPosition = new Offset(0, 0);
            widget.layout(BoxConstraints.tight(termScreen.size));

            widget.scrollBy(-10, -10);
            expect(widget.scrollLeft).toBe(0);
            expect(widget.scrollTop).toBe(0);
        });
    });

    describe("render", () => {
        it("renders top-left corner when scroll is at origin", () => {
            const { widget } = createGrid(5, 3, 20, 10);
            const backend = renderElement(widget, 5, 3);

            // (x+y) % 10 for each cell
            // y=0: 0 1 2 3 4
            // y=1: 1 2 3 4 5
            // y=2: 2 3 4 5 6
            expectScreen(
                backend,
                screen`
                    01234
                    12345
                    23456
                `,
            );
        });

        it("renders with vertical scroll offset", () => {
            const { widget, termScreen } = createGrid(5, 3, 20, 10);
            widget.localPosition = new Offset(0, 0);
            widget.layout(BoxConstraints.tight(termScreen.size));
            widget.scrollTo(0, 5);

            const backend = renderElement(widget, 5, 3);

            // y=5: 5 6 7 8 9
            // y=6: 6 7 8 9 0
            // y=7: 7 8 9 0 1
            expectScreen(
                backend,
                screen`
                    56789
                    67890
                    78901
                `,
            );
        });

        it("renders with horizontal scroll offset", () => {
            const { widget, termScreen } = createGrid(5, 3, 20, 10);
            widget.localPosition = new Offset(0, 0);
            widget.layout(BoxConstraints.tight(termScreen.size));
            widget.scrollTo(7, 0);

            const backend = renderElement(widget, 5, 3);

            // x starts at 7
            // y=0: 7 8 9 0 1
            // y=1: 8 9 0 1 2
            // y=2: 9 0 1 2 3
            expectScreen(
                backend,
                screen`
                    78901
                    89012
                    90123
                `,
            );
        });

        it("renders with both scroll offsets", () => {
            const { widget, termScreen } = createGrid(5, 3, 20, 10);
            widget.localPosition = new Offset(0, 0);
            widget.layout(BoxConstraints.tight(termScreen.size));
            widget.scrollTo(4, 3);

            const backend = renderElement(widget, 5, 3);

            // x starts at 4, y starts at 3
            // y=3, x=4: (4+3)%10=7  (5+3)=8  (6+3)=9  (7+3)=0  (8+3)=1
            // y=4, x=4: (4+4)%10=8  ...
            // y=5, x=4: (4+5)%10=9  ...
            expectScreen(
                backend,
                screen`
                    78901
                    89012
                    90123
                `,
            );
        });

        it("handles content smaller than viewport", () => {
            const { widget } = createGrid(10, 5, 3, 2);
            const backend = renderElement(widget, 10, 5);

            const lines = backend.screenToString().split("\n");
            expect(lines[0].slice(0, 3)).toBe("012");
            expect(lines[1].slice(0, 3)).toBe("123");
        });
    });

    // Кадр ввода рендерится только по dirty-флагу (dirty-гейт TuiApplication),
    // поэтому смена скролла обязана помечать layout грязным сама.
    describe("scrollTo и dirty-флаг", () => {
        it("смена позиции скролла помечает layout грязным", () => {
            const { widget } = createGrid(5, 3, 20, 20);
            renderElement(widget, 5, 3);
            expect(widget.isLayoutDirty).toBe(false);

            widget.scrollTo(0, 4);

            expect(widget.scrollTop).toBe(4);
            expect(widget.isLayoutDirty).toBe(true);
        });

        it("no-op скролл (та же позиция после clamp) флаг не трогает", () => {
            const { widget } = createGrid(5, 3, 20, 20);
            widget.scrollTo(0, 4);
            renderElement(widget, 5, 3);
            expect(widget.isLayoutDirty).toBe(false);

            widget.scrollTo(0, 4);
            // За пределами контента clamp возвращает ту же позицию.
            widget.scrollTo(-5, 4);

            expect(widget.isLayoutDirty).toBe(false);
        });
    });
});
