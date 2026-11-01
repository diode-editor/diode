import { DisplayLine } from "@tuidom/core/common/displayLine";
import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { truncateEnd } from "@tuidom/core/common/textTruncation";
import { BORDER_THICKNESS } from "@tuidom/core/dom/borderStyle";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";

/** Shared by the query, the message and list rows: separate literals left the query misaligned with the results. */
export const CONTENT_PAD = 1;

const BACK_GLYPH = "←";

/**
 * A title set into the border (`┤ Save As ├`) and a separator at a given row — things the engine's
 * `BoxContainerElement` can't do. The frame doesn't handle content padding: a `PaddingContainerElement`
 * inside provides it.
 */
export class QuickPickFrameElement extends TUIElement {
    private readonly child: TUIElement;
    private titleValue: string | undefined = undefined;
    /** In element coordinates; null means no separator. */
    private separatorRowValue: number | null = null;
    private backVisibleValue = false;
    /** Where the last frame drew the Back button; `null` when it did not fit or is off. */
    private backColumn: number | null = null;

    public constructor(child: TUIElement) {
        super();
        this.child = child;
        this.appendChild(child);
    }

    public get title(): string | undefined {
        return this.titleValue;
    }

    public setTitle(value: string | undefined): void {
        if (this.titleValue === value) return;
        this.titleValue = value;
        this.markDirty();
    }

    public get backVisible(): boolean {
        return this.backVisibleValue;
    }

    public setBackVisible(value: boolean): void {
        // Stryker disable next-line ConditionalExpression: only saves a repaint, the frame comes out the same
        if (this.backVisibleValue === value) return;
        this.backVisibleValue = value;
        // Stryker disable next-line CallExpression: the only caller, the session, repaints the widget after each update
        this.markDirty();
    }

    /** In element coordinates. */
    public isBackButtonAt(x: number, y: number): boolean {
        return y === 0 && x === this.backColumn;
    }

    public setSeparatorRow(value: number | null): void {
        if (this.separatorRowValue === value) return;
        this.separatorRowValue = value;
        this.markDirty();
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const inner = new Size(
            Math.max(0, size.width - BORDER_THICKNESS * 2),
            Math.max(0, size.height - BORDER_THICKNESS * 2),
        );
        this.layoutChild(this.child, BORDER_THICKNESS, BORDER_THICKNESS, BoxConstraints.tight(inner));
        return size;
    }

    public override render(context: RenderContext): void {
        const w = this.layoutSize.width;
        const h = this.layoutSize.height;
        if (w < BORDER_THICKNESS * 2 || h < BORDER_THICKNESS * 2) return;

        const border = this.styleVar("quickPick.border");
        const background = this.styleVar("quickInput.background");

        // The separator is part of the box, not a separate loop: the spacer row doesn't paint
        // its background, so the line shows through from under the children.
        const separator = this.separatorRowValue;
        const separators = separator !== null && separator > 0 && separator < h - 1 ? [separator] : undefined;
        context.drawBox(0, 0, w, h, { fg: border, bg: background, fill: true, separators });

        this.backColumn = null;
        const title = [this.backVisibleValue ? BACK_GLYPH : "", this.titleValue ?? ""]
            .filter((part) => part !== "")
            .join(" ");
        if (title !== "") this.renderTitle(context, title, w, background, border);

        this.renderChildren(context);
    }

    private renderTitle(context: RenderContext, title: string, w: number, background: number, border: number): void {
        // The two caps, the border corners and the label's spaces. Cut, not dropped: the title carries the Back arrow.
        const room = w - 6;
        if (room <= 0) return;
        const label = ` ${truncateEnd(title, room)} `;
        const labelWidth = new DisplayLine(label).displayWidth;
        const startX = Math.max(2, Math.floor((w - labelWidth) / 2));
        context.setCell(startX - 1, 0, { char: "┤", fg: border, bg: background });
        context.drawText(startX, 0, label, { fg: this.styleVar("quickPick.titleForeground"), bg: background });
        context.setCell(startX + labelWidth, 0, { char: "├", fg: border, bg: background });
        // The leading space of the label comes first.
        // Stryker disable next-line ConditionalExpression: without the button goBack ignores a click there anyway
        if (this.backVisibleValue) this.backColumn = startX + 1;
    }
}
