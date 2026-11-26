import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { BORDER_THICKNESS } from "@tuidom/core/dom/borderStyle";
import { TUIElement } from "@tuidom/core/dom/tuiElement";

/**
 * The group frame's right line plus a column between it and the widget, as find
 * (docs/arch/workbench/Frames.md).
 */
export const CORNER_RIGHT_MARGIN = BORDER_THICKNESS + 1;

/**
 * A row of an editor group's overlay layer that keeps its widget at the right edge on every layout: the overlay
 * layer places items at fixed points, and a group changes width with a split, a sash or the window. The row itself
 * is transparent: it paints nothing and a click beside the widget falls through to the editor.
 */
export class CornerDockElement extends TUIElement {
    /**
     * The row's width changed; called after the frame (a widget that adapts to it rebuilds outside the layout).
     */
    public onDidChangeWidth: (width: number) => void = () => undefined;
    private laidOutWidth: number | null = null;

    public setChild(child: TUIElement): void {
        this.setChildren([child]);
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const width = constraints.maxWidth;
        const room = Math.max(0, width - CORNER_RIGHT_MARGIN);
        let height = 0;
        const child = this.getChildren().at(0);
        if (child !== undefined) {
            const childWidth = Math.min(room, child.getMaxIntrinsicWidth(0));
            height = Math.min(constraints.maxHeight, child.getMaxIntrinsicHeight(childWidth));
            this.layoutChild(child, room - childWidth, 0, BoxConstraints.tight(new Size(childWidth, height)));
        }
        if (width !== this.laidOutWidth) {
            this.laidOutWidth = width;
            queueMicrotask(() => {
                this.onDidChangeWidth(width);
            });
        }
        const size = constraints.constrain(new Size(width, height));
        super.performLayout(BoxConstraints.tight(size));
        return size;
    }

    // Stryker disable next-line BlockStatement: an empty body returns undefined, which the hit test reads as false
    protected override hitTestSelf(): boolean {
        return false;
    }
}
