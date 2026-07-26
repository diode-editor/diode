import { BoxConstraints, Size } from "../../common/geometryPromitives.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

export interface StatusBarItem {
    text: string;
    /** Side of the bar to render on. Defaults to "left". */
    align?: "left" | "right";
    /**
     * Invoked when the item's cells are clicked. A plain callback keeps the
     * widget command-agnostic — the owning controller decides what a click
     * means. Items without it are inert.
     */
    onClick?: () => void;
}

interface HitRegion {
    readonly start: number;
    /** Exclusive. */
    readonly end: number;
    readonly item: StatusBarItem;
}

export class StatusBarElement extends TUIElement {
    /**
     * Horizontal padding of the bar's content area, applied to both edges.
     * Besides breathing room, it keeps the last character of right-aligned
     * items out of the terminal's bottom-right corner cell, which the renderer
     * never writes (doing so triggers hardware scroll).
     */
    private static readonly paddingX = 1;

    private items: StatusBarItem[] = [];

    public constructor() {
        super();
        this.addEventListener("click", (event) => {
            this.hitTest(event.localX)?.item.onClick?.();
        });
    }

    /**
     * Maps a bar-local x coordinate to the item whose cells it lands on, or
     * null for padding and the two-cell separators between items. Recomputes
     * the same layout math as {@link render}, so it can't go stale between
     * frames. Cells of a right-aligned item hidden by the left side (left wins
     * on overlap, see render) hit nothing.
     */
    private hitTest(x: number): HitRegion | null {
        const width = this.layoutSize.width;
        const pad = StatusBarElement.paddingX;
        const leftEnd = pad + this.leftText().length;

        let cursor = pad;
        for (const item of this.items.filter((i) => i.align !== "right")) {
            if (x >= cursor && x < cursor + item.text.length) {
                return { start: cursor, end: cursor + item.text.length, item };
            }
            cursor += item.text.length + 2;
        }

        cursor = width - pad - this.rightText().length;
        for (const item of this.items.filter((i) => i.align === "right")) {
            if (x >= cursor && x < cursor + item.text.length && x >= leftEnd) {
                return { start: cursor, end: cursor + item.text.length, item };
            }
            cursor += item.text.length + 2;
        }
        return null;
    }

    public setItems(items: StatusBarItem[]): void {
        this.items = items;
        this.markDirty();
    }

    public getItems(): readonly StatusBarItem[] {
        return this.items;
    }

    public override getMinIntrinsicWidth(_height: number): number {
        return this.intrinsicWidth();
    }

    public override getMaxIntrinsicWidth(_height: number): number {
        return this.intrinsicWidth();
    }

    private leftText(): string {
        return this.items
            .filter((item) => item.align !== "right")
            .map((item) => item.text)
            .join("  ");
    }

    private rightText(): string {
        return this.items
            .filter((item) => item.align === "right")
            .map((item) => item.text)
            .join("  ");
    }

    private intrinsicWidth(): number {
        const left = this.leftText();
        const right = this.rightText();
        if (left.length === 0 && right.length === 0) return 0;
        const gap = left.length > 0 && right.length > 0 ? 2 : 0;
        return left.length + gap + right.length + StatusBarElement.paddingX * 2;
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return 1;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return 1;
    }

    public override performLayout(constraints: BoxConstraints): Size {
        const size = new Size(constraints.maxWidth, 1);
        return super.performLayout(BoxConstraints.tight(size));
    }

    public override render(context: RenderContext): void {
        const width = this.layoutSize.width;
        const resolved = this.resolvedStyle;

        const left = this.leftText();
        const right = this.rightText();

        // Background
        for (let x = 0; x < width; x++) {
            context.setCell(x, 0, { char: " ", fg: resolved.fg, bg: resolved.bg });
        }

        const pad = StatusBarElement.paddingX;

        // Left-aligned items, inset by the bar padding.
        for (let i = 0; i < left.length && pad + i < width; i++) {
            context.setCell(pad + i, 0, { char: left[i], fg: resolved.fg, bg: resolved.bg });
        }

        // Right-aligned items, flush to the padded right edge. Skip any cell
        // that falls into the left padding or that a left item already owns —
        // left items win on overlap. The last cell lands at width-1-paddingX,
        // so an upper-bound check is unnecessary.
        const rightStart = width - pad - right.length;
        for (let i = 0; i < right.length; i++) {
            const x = rightStart + i;
            if (x < pad + left.length) continue;
            context.setCell(x, 0, { char: right[i], fg: resolved.fg, bg: resolved.bg });
        }
    }
}
