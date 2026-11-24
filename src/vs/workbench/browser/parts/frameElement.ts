import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { BORDER_ROUNDED, BORDER_THICKNESS } from "@tuidom/core/dom/borderStyle";
import type { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TUIElement } from "@tuidom/core/dom/tuiElement";

/**
 * A part's content with horizontal separators (a line between views, under a header) that run
 * from one side of the frame to the other: the frame meets each of them with `├ ┤`.
 */
export interface IFrameJointSource {
    /** Rows of the separators, in the source's own coordinates. */
    getFrameJointRows(): readonly number[];
}

export function isFrameJointSource(element: TUIElement): element is TUIElement & IFrameJointSource {
    return typeof (element as Partial<IFrameJointSource>).getFrameJointRows === "function";
}

/**
 * The rounded frame every workbench part sits in (docs/arch/workbench/Frames.md): one cell of line
 * on each side, the part inside. The frame lies on the part's own background, so the frame and the
 * part read as one surface and the line alone separates parts — no colour tricks. With
 * {@link openTop} the frame has no top line: the editor group's tabs above it draw it (their
 * baseline), and the part starts right under them.
 */
export class FrameElement extends TUIElement {
    private child: TUIElement | null;
    private openTopValue = false;
    private jointRows: readonly number[] = [];

    public constructor(child: TUIElement | null = null) {
        super();
        this.child = child;
        if (child !== null) this.appendChild(child);
    }

    public getChild(): TUIElement | null {
        return this.child;
    }

    public setChild(child: TUIElement | null): void {
        if (this.child === child) return;
        if (this.child !== null) this.removeChild(this.child);
        this.child = child;
        if (child !== null) this.appendChild(child);
        this.markDirty();
    }

    public get openTop(): boolean {
        return this.openTopValue;
    }

    public set openTop(value: boolean) {
        if (this.openTopValue === value) return;
        this.openTopValue = value;
        this.markDirty();
    }

    /** Rows where the frame meets a separator of its part, in the frame's coordinates. */
    public getJointRows(): readonly number[] {
        return this.jointRows;
    }

    private get topInset(): number {
        return this.openTopValue ? 0 : BORDER_THICKNESS;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const child = this.child;
        if (child === null) {
            this.updateJoints([]);
            return size;
        }
        const top = this.topInset;
        const innerWidth = Math.max(0, size.width - 2 * BORDER_THICKNESS);
        const innerHeight = Math.max(0, size.height - top - BORDER_THICKNESS);
        this.layoutChild(child, BORDER_THICKNESS, top, BoxConstraints.tight(new Size(innerWidth, innerHeight)));
        const rows = isFrameJointSource(child)
            ? child
                  .getFrameJointRows()
                  .map((row) => row + top)
                  .filter((row) => row < top + innerHeight)
            : [];
        this.updateJoints(rows);
        return size;
    }

    /** The joints live in the frame's own cells: when the part's separators move, the frame repaints. */
    private updateJoints(rows: readonly number[]): void {
        if (rows.length === this.jointRows.length && rows.every((row, i) => row === this.jointRows[i])) return;
        this.jointRows = rows;
        this.markPaintDirtyDuringLayout();
    }

    public override render(context: RenderContext): void {
        const { width, height } = this.layoutSize;
        if (width < 2 || height < 2) {
            this.renderChildren(context);
            return;
        }
        const fg = this.styleVar("panel.border");
        const bg = this.child?.resolvedStyle.bg ?? this.resolvedStyle.bg;
        const style = BORDER_ROUNDED;
        const right = width - 1;
        const bottom = height - 1;

        if (this.openTopValue) {
            for (let y = 0; y < bottom; y++) {
                context.setCell(0, y, { char: style.vertical, fg, bg });
                context.setCell(right, y, { char: style.vertical, fg, bg });
            }
            context.setCell(0, bottom, { char: style.bottomLeft, fg, bg });
            context.setCell(right, bottom, { char: style.bottomRight, fg, bg });
            for (let x = 1; x < right; x++) context.setCell(x, bottom, { char: style.horizontal, fg, bg });
        } else {
            context.drawBox(0, 0, width, height, { fg, bg, style });
        }
        for (const row of this.jointRows) {
            context.setCell(0, row, { char: style.leftJoint, fg, bg });
            context.setCell(right, row, { char: style.rightJoint, fg, bg });
        }
        this.renderChildren(context);
    }
}
