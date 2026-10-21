import { BoxConstraints, Offset, Point, Rect, Size } from "@tuidom/core/common/geometryPromitives";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";
import { TerminalScreen } from "@tuidom/core/rendering/terminalScreen";
import { SashElement } from "@tuidom/elements/sash/sashElement";
import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { describe, expect, it, vi } from "vitest";

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
}

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
    layout.layout(BoxConstraints.tight(new Size(options.width ?? 100, 10)));
    return layout;
}

function frameRow(layout: WorkbenchLayoutElement, row = 0): string {
    const size = layout.layoutSize;
    const backend = new MockTerminalBackend(size);
    const screen = new TerminalScreen(size);
    layout.render(new RenderContext(screen, new Offset(0, 0), new Rect(new Point(0, 0), size)));
    screen.flush(backend);
    return backend.getTextAt(new Point(0, row), size.width);
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
        expect(layout.getChildren()).toContain(right);
        expect(right.hidden).toBe(true);
        expect(rightSash(layout).hidden).toBe(true);
        expect(frameRow(layout)).toBe("C".repeat(40));
    });

    it("when visible it is on the right at full height, default width 30 in a wide window", () => {
        const layout = build({ width: 140 });
        expect(frameRow(layout)).toBe("L".repeat(20) + "C".repeat(90) + "R".repeat(30));
        expect(frameRow(layout, 9)).toBe("L".repeat(20) + "C".repeat(90) + "R".repeat(30));
    });

    it("the default width is at most a quarter of the window (upstream min(300, w/4))", () => {
        expect(frameRow(build({ width: 100 }))).toBe("L".repeat(20) + "C".repeat(55) + "R".repeat(25));
        expect(build({ width: 100 }).getRightPanelWidth()).toBeNull();
    });

    it("the default is not below the minimum even in a window narrower than 48 columns", () => {
        const layout = build({ width: 44, left: false });
        expect(frameRow(layout)).toBe("C".repeat(32) + "R".repeat(12));
    });

    it("the bottom panel is only below the editor (center alignment): side bars take the full height", () => {
        const layout = build({ width: 100, bottom: true });
        expect(frameRow(layout, 9)).toBe("L".repeat(20) + "B".repeat(55) + "R".repeat(25));
        expect(frameRow(layout, 5)).toBe("L".repeat(20) + "C".repeat(55) + "R".repeat(25));
    });

    it("a set width holds while there is room", () => {
        const layout = build({ width: 120, rightWidth: 40 });
        expect(frameRow(layout)).toBe("L".repeat(20) + "C".repeat(60) + "R".repeat(40));
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
            expect(frameRow(layout)).toBe("L".repeat(30) + "C".repeat(20) + "R".repeat(30));
        });

        it("with the right panel at its minimum, the left one shrinks next", () => {
            const layout = build({ width: 50, leftWidth: 30, rightWidth: 40 });
            expect(frameRow(layout)).toBe("L".repeat(18) + "C".repeat(20) + "R".repeat(12));
        });

        it("even minimums do not fit: panels stay inside the window, the editor gives up its share", () => {
            const layout = build({ width: 30, leftWidth: 30, rightWidth: 40 });
            expect(frameRow(layout)).toBe("L".repeat(12) + "C".repeat(6) + "R".repeat(12));
        });

        it("a fully degenerate window: the right panel yields entirely", () => {
            const layout = build({ width: 14, leftWidth: 30, rightWidth: 40 });
            expect(frameRow(layout)).toBe("L".repeat(12) + "R".repeat(2));
            // The frame is clipped by the window; the width is visible only through the box.
            expect(layout.getRightPanel()!.layoutSize.width).toBe(2);
        });

        it("clamping is on screen only: saved widths survive a narrow terminal", () => {
            const layout = build({ width: 50, leftWidth: 30, rightWidth: 40 });
            expect(layout.getRightPanelWidth()).toBe(40);
            expect(layout.getLeftPanelWidth()).toBe(30);
            layout.layout(BoxConstraints.tight(new Size(140, 10)));
            expect(frameRow(layout)).toBe("L".repeat(30) + "C".repeat(70) + "R".repeat(40));
        });

        it("a hidden left panel takes no room from the right one", () => {
            const layout = build({ width: 80, left: false, rightWidth: 70 });
            expect(frameRow(layout)).toBe("C".repeat(20) + "R".repeat(60));
        });
    });

    describe("mouse resize", () => {
        it("the sash sits on the panel's first column at full height", () => {
            const layout = build({ width: 100 });
            const sash = rightSash(layout);
            expect(sash.hidden).toBe(false);
            expect(sash.globalPosition).toEqual(new Point(75, 0));
            expect(sash.layoutSize).toEqual(new Size(1, 10));
        });

        it("sash drag: the border column becomes the panel's first column", () => {
            const layout = build({ width: 100 });
            const onChange = vi.fn();
            layout.onDidChangeLayout = onChange;
            rightSash(layout).onDrag?.(60);
            expect(layout.getRightPanelWidth()).toBe(40);
            expect(onChange).toHaveBeenCalledTimes(1);
            layout.layout(BoxConstraints.tight(new Size(100, 10)));
            expect(frameRow(layout)).toBe("L".repeat(20) + "C".repeat(40) + "R".repeat(40));
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
            expect(frameRow(layout)).toBe("L".repeat(68) + "C".repeat(20) + "R".repeat(12));
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
        expect(rightSash(layout).hidden).toBe(true);
        layout.layout(BoxConstraints.tight(new Size(100, 10)));
        expect(frameRow(layout)).toBe("L".repeat(20) + "C".repeat(80));
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
        const layout = build({ width: 100, bottom: true });
        layout.nudgeBottomPanelHeight(2);
        expect(layout.getBottomPanelHeight()).toBe(6);
        layout.nudgeBottomPanelHeight(-100);
        expect(layout.getBottomPanelHeight()).toBe(3);
        layout.nudgeBottomPanelHeight(100);
        expect(layout.getBottomPanelHeight()).toBe(7);
    });
});
