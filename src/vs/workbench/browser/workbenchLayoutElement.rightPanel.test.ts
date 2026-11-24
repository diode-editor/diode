import { BoxConstraints, Offset, Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { SashElement } from "@tuidom/elements/sash/sashElement";
import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../TestUtils/renderElement.ts";

import { FrameElement } from "./parts/frameElement.ts";
import { WorkbenchLayoutElement } from "./workbenchLayoutElement.ts";

class FillPanel extends TUIElement {
    public constructor(private readonly marker: string) {
        super();
    }

    public override render(context: RenderContext): void {
        for (let y = 0; y < this.layoutSize.height; y++) {
            for (let x = 0; x < this.layoutSize.width; x++) {
                context.setCell(x, y, { char: this.marker, fg: 0, bg: 0 });
            }
        }
    }
}

interface Options {
    readonly width?: number;
    readonly left?: boolean;
    readonly leftWidth?: number;
    readonly rightWidth?: number | null;
    readonly bottom?: boolean;
    readonly height?: number;
}

const HEIGHT = 10;
/** A row inside the frames (not their top or bottom line). */
const INNER_ROW = 1;

function build(options: Options = {}): WorkbenchLayoutElement {
    const layout = new WorkbenchLayoutElement();
    if (options.left !== false) {
        layout.setLeftPanel(new FillPanel("L"));
        layout.setLeftPanelWidth(options.leftWidth ?? 20);
    }
    layout.setCenterContent(new FillPanel("C"));
    layout.setRightPanel(new FillPanel("R"));
    layout.setRightPanelVisible(true);
    if (options.rightWidth !== undefined) layout.setRightPanelWidth(options.rightWidth);
    if (options.bottom === true) {
        layout.setBottomPanel(new FillPanel("B"));
        layout.setBottomPanelVisible(true);
        layout.setBottomPanelHeight(4);
    }
    layout.localPosition = new Offset(0, 0);
    layout.layout(BoxConstraints.tight(new Size(options.width ?? 100, options.height ?? HEIGHT)));
    return layout;
}

/** One screen row of the layout. A theme is required: the part frames read `panel.border`. */
function frameRow(layout: WorkbenchLayoutElement, row = INNER_ROW): string {
    const size = layout.layoutSize;
    const backend = renderElement(layout, size.width, size.height, { themeVars: true });
    return backend.getTextAt(new Point(0, row), size.width);
}

/** A framed part's slot `width` wide on a row inside the frame: the side lines and the part between. */
function framed(marker: string, width: number): string {
    return `│${marker.repeat(width - 2)}│`;
}

/** A framed part's slot on the frame's bottom row. */
function frameBottom(width: number): string {
    return `╰${"─".repeat(width - 2)}╯`;
}

function frameOf(part: TUIElement): FrameElement {
    const frame = part.getParent();
    expect(frame).toBeInstanceOf(FrameElement);
    return frame as FrameElement;
}

function rightSash(layout: WorkbenchLayoutElement): SashElement {
    // Sash order: left, right, bottom.
    return layout.getChildren().filter((c) => c instanceof SashElement)[1];
}

describe("WorkbenchLayoutElement: right panel (secondary side bar)", () => {
    it("hidden by default: the editor takes the remaining width, the panel is in the tree with hidden", () => {
        const layout = new WorkbenchLayoutElement();
        const right = new FillPanel("R");
        layout.setCenterContent(new FillPanel("C"));
        layout.setRightPanel(right);
        layout.localPosition = new Offset(0, 0);
        layout.layout(BoxConstraints.tight(new Size(40, 3)));

        expect(layout.getRightPanelVisible()).toBe(false);
        expect(layout.getChildren()).toContain(frameOf(right));
        expect(right.hidden).toBe(true);
        expect(frameOf(right).hidden).toBe(true);
        expect(rightSash(layout).hidden).toBe(true);
        expect(frameRow(layout)).toBe("C".repeat(40));
    });

    it("when visible it is on the right at full height, default width 30 in a wide window", () => {
        const layout = build({ width: 140 });
        expect(frameRow(layout)).toBe(framed("L", 20) + "C".repeat(90) + framed("R", 30));
        expect(frameRow(layout, HEIGHT - 2)).toBe(framed("L", 20) + "C".repeat(90) + framed("R", 30));
        expect(frameRow(layout, HEIGHT - 1)).toBe(frameBottom(20) + "C".repeat(90) + frameBottom(30));
    });

    it("the default width is at most a quarter of the window (upstream min(300, w/4))", () => {
        expect(frameRow(build({ width: 100 }))).toBe(framed("L", 20) + "C".repeat(55) + framed("R", 25));
        expect(build({ width: 100 }).getRightPanelWidth()).toBeNull();
    });

    it("the default is not below the minimum even in a window narrower than 48 columns", () => {
        const layout = build({ width: 44, left: false });
        expect(frameRow(layout)).toBe("C".repeat(32) + framed("R", 12));
    });

    it("the bottom panel is only below the editor (center alignment): side bars take the full height", () => {
        const layout = build({ width: 100, bottom: true });
        // The panel (4 rows: rows 6..9) inside its frame, between the side bars' frames.
        expect(frameRow(layout, HEIGHT - 2)).toBe(framed("L", 20) + framed("B", 55) + framed("R", 25));
        expect(frameRow(layout, HEIGHT - 1)).toBe(frameBottom(20) + frameBottom(55) + frameBottom(25));
        expect(frameRow(layout, 5)).toBe(framed("L", 20) + "C".repeat(55) + framed("R", 25));
    });

    it("a set width holds while there is room", () => {
        const layout = build({ width: 120, rightWidth: 40 });
        expect(frameRow(layout)).toBe(framed("L", 20) + "C".repeat(60) + framed("R", 40));
        expect(layout.getRightPanelWidth()).toBe(40);
    });

    it("the setter enforces the lower bound and rounds; null restores the dynamic default", () => {
        const layout = new WorkbenchLayoutElement();
        layout.setRightPanelWidth(3);
        expect(layout.getRightPanelWidth()).toBe(12);
        layout.setRightPanelWidth(33.6);
        expect(layout.getRightPanelWidth()).toBe(34);
        layout.setRightPanelWidth(null);
        expect(layout.getRightPanelWidth()).toBeNull();
    });

    describe("narrow window: the right panel yields first, the editor keeps 20 columns", () => {
        it("80 columns, 30 + 40: the right panel shrinks to the remainder", () => {
            const layout = build({ width: 80, leftWidth: 30, rightWidth: 40 });
            expect(frameRow(layout)).toBe(framed("L", 30) + "C".repeat(20) + framed("R", 30));
        });

        it("with the right panel at its minimum, the left one shrinks next", () => {
            const layout = build({ width: 50, leftWidth: 30, rightWidth: 40 });
            expect(frameRow(layout)).toBe(framed("L", 18) + "C".repeat(20) + framed("R", 12));
        });

        it("even minimums do not fit: panels stay inside the window, the editor gives up its share", () => {
            const layout = build({ width: 30, leftWidth: 30, rightWidth: 40 });
            expect(frameRow(layout)).toBe(framed("L", 12) + "C".repeat(6) + framed("R", 12));
        });

        it("a fully degenerate window: the right panel yields entirely", () => {
            const layout = build({ width: 14, leftWidth: 30, rightWidth: 40 });
            // The right panel's slot is just its two frame lines.
            expect(frameRow(layout)).toBe(framed("L", 12) + framed("R", 2));
            expect(frameOf(layout.getRightPanel()!).layoutSize.width).toBe(2);
            expect(layout.getRightPanel()!.layoutSize.width).toBe(0);
        });

        it("clamping is on screen only: saved widths survive a narrow terminal", () => {
            const layout = build({ width: 50, leftWidth: 30, rightWidth: 40 });
            expect(layout.getRightPanelWidth()).toBe(40);
            expect(layout.getLeftPanelWidth()).toBe(30);
            layout.layout(BoxConstraints.tight(new Size(140, 10)));
            expect(frameRow(layout)).toBe(framed("L", 30) + "C".repeat(70) + framed("R", 40));
        });

        it("a hidden left panel takes no room from the right one", () => {
            const layout = build({ width: 80, left: false, rightWidth: 70 });
            expect(frameRow(layout)).toBe("C".repeat(20) + framed("R", 60));
        });
    });

    describe("mouse resize", () => {
        it("the sash spans the editor's last column and the panel frame's first, at full height", () => {
            const layout = build({ width: 100 });
            const sash = rightSash(layout);
            expect(sash.hidden).toBe(false);
            expect(sash.globalPosition).toEqual(new Point(frameOf(layout.getRightPanel()!).globalPosition.x - 1, 0));
            expect(sash.globalPosition).toEqual(new Point(74, 0));
            expect(sash.layoutSize).toEqual(new Size(2, HEIGHT));
        });

        it("sash drag: the reported column becomes the panel frame's first column", () => {
            const layout = build({ width: 100 });
            const onChange = vi.fn();
            layout.onDidChangeLayout = onChange;
            rightSash(layout).onDrag?.(60);
            expect(layout.getRightPanelWidth()).toBe(40);
            expect(onChange).toHaveBeenCalledTimes(1);
            layout.layout(BoxConstraints.tight(new Size(100, 10)));
            expect(frameRow(layout)).toBe(framed("L", 20) + "C".repeat(40) + framed("R", 40));
        });

        it("dragging does not squeeze a shown left panel: the maximum stops at the editor minimum", () => {
            const layout = build({ width: 100 });
            rightSash(layout).onDrag?.(0);
            expect(layout.getRightPanelWidth()).toBe(60);
        });

        it("dragging does not go below the minimum", () => {
            const layout = build({ width: 100 });
            rightSash(layout).onDrag?.(99);
            expect(layout.getRightPanelWidth()).toBe(12);
        });

        it("accounts for the layout's screen offset", () => {
            const layout = build({ width: 100 });
            layout.localPosition = new Offset(5, 0);
            layout.layout(BoxConstraints.tight(new Size(100, 10)));
            rightSash(layout).onDrag?.(75);
            expect(layout.getRightPanelWidth()).toBe(30);
        });
    });

    describe("keyboard resize (nudge)", () => {
        it("steps from the dynamic default when no width is set", () => {
            const layout = build({ width: 100 });
            layout.nudgeRightPanelWidth(3);
            expect(layout.getRightPanelWidth()).toBe(28);
        });

        it("steps from the set width and clamps on both sides", () => {
            const layout = build({ width: 100, rightWidth: 30 });
            layout.nudgeRightPanelWidth(-3);
            expect(layout.getRightPanelWidth()).toBe(27);
            layout.nudgeRightPanelWidth(-100);
            expect(layout.getRightPanelWidth()).toBe(12);
            layout.nudgeRightPanelWidth(1000);
            expect(layout.getRightPanelWidth()).toBe(60);
        });

        it("notifies the subscriber", () => {
            const layout = build({ width: 100 });
            const onChange = vi.fn();
            layout.onDidChangeLayout = onChange;
            layout.nudgeRightPanelWidth(1);
            expect(onChange).toHaveBeenCalledTimes(1);
        });
    });

    describe("left panel with the right one shown", () => {
        it("dragging the left sash leaves the right panel its minimum", () => {
            const layout = build({ width: 100 });
            const leftSash = layout.getChildren().find((c) => c instanceof SashElement)!;
            leftSash.onDrag?.(99);
            // 100 - 20 (editor) - 12 (right minimum) = 68.
            expect(layout.getLeftPanelWidth()).toBe(68);
            layout.layout(BoxConstraints.tight(new Size(100, 10)));
            expect(frameRow(layout)).toBe(framed("L", 68) + "C".repeat(20) + framed("R", 12));
        });

        it("without the right panel the left one grows up to the editor minimum, as before", () => {
            const layout = build({ width: 100 });
            layout.setRightPanelVisible(false);
            layout.nudgeLeftPanelWidth(1000);
            expect(layout.getLeftPanelWidth()).toBe(80);
        });
    });

    it("visibility: the toggle notifies the subscriber and hides the sash along with the panel", () => {
        const layout = build({ width: 100 });
        const onChange = vi.fn();
        layout.onDidChangeLayout = onChange;
        layout.setRightPanelVisible(false);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(layout.getRightPanel()?.hidden).toBe(true);
        expect(frameOf(layout.getRightPanel()!).hidden).toBe(true);
        expect(rightSash(layout).hidden).toBe(true);
        layout.layout(BoxConstraints.tight(new Size(100, 10)));
        expect(frameRow(layout)).toBe(framed("L", 20) + "C".repeat(80));
    });

    it("visible without an element: the layout does not break and the sash stays hidden", () => {
        const layout = new WorkbenchLayoutElement();
        layout.setCenterContent(new FillPanel("C"));
        layout.setRightPanelVisible(true);
        layout.localPosition = new Offset(0, 0);
        layout.layout(BoxConstraints.tight(new Size(40, 3)));
        expect(frameRow(layout)).toBe("C".repeat(40));
        expect(rightSash(layout).hidden).toBe(true);
    });

    it("replacing the right panel element detaches the previous one", () => {
        const layout = new WorkbenchLayoutElement();
        const first = new FillPanel("1");
        const second = new FillPanel("2");
        layout.setRightPanel(first);
        layout.setRightPanel(second);
        expect(first.getParent()).toBeNull();
        expect(layout.getRightPanel()).toBe(second);
    });

    it("bottom panel height nudge: step and clamp", () => {
        // 12 rows: the maximum is 12 - MIN_EDITOR_HEIGHT (5) = 7.
        const layout = build({ width: 100, bottom: true, height: 12 });
        layout.nudgeBottomPanelHeight(2);
        expect(layout.getBottomPanelHeight()).toBe(6);
        layout.nudgeBottomPanelHeight(-100);
        // MIN_PANEL_HEIGHT: two frame lines, the tabs and a content row.
        expect(layout.getBottomPanelHeight()).toBe(4);
        layout.nudgeBottomPanelHeight(100);
        expect(layout.getBottomPanelHeight()).toBe(7);
    });
});
