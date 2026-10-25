import type { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { wrapText } from "@tuidom/elements/completionlist/completionDetailsElement";

/** The same column as the welcome text and tree rows. */
const LEFT_PADDING = 1;

/**
 * Upstream `TreeView.message`: a line of text above the tree, wrapped in a narrow sidebar. Empty — no rows
 * at all, so the tree starts right under the header. Painted directly, like `ViewWelcomeElement`: the
 * wrapping depends on the width from layout.
 */
export class ViewMessageElement extends TUIElement {
    private text = "";

    public constructor() {
        super();
        this.style = { fg: "descriptionForeground" };
    }

    public getText(): string {
        return this.text;
    }

    public setText(text: string): void {
        // Stryker disable next-line ConditionalExpression: equivalent — the same text marked dirty again repaints the same frame
        if (this.text === text) return;
        this.text = text;
        this.markDirty();
    }

    public override getMinIntrinsicHeight(width: number): number {
        return this.lines(width).length;
    }

    public override getMaxIntrinsicHeight(width: number): number {
        return this.lines(width).length;
    }

    public override render(context: RenderContext): void {
        // Stryker disable next-line CallExpression: equivalent — the element has no background or children of its own to paint
        super.render(context);
        const { fg, bg } = this.resolvedStyle;
        for (const [y, line] of this.lines(this.layoutSize.width).entries()) {
            context.drawText(LEFT_PADDING, y, line, { fg, bg });
        }
    }

    private lines(width: number): readonly string[] {
        if (this.text === "") return [];
        return this.text.split("\n").flatMap((paragraph) => wrapText(paragraph, Math.max(1, width - LEFT_PADDING)));
    }
}
