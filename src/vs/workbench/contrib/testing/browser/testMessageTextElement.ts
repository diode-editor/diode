import type { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import type { RenderContext } from "@tuidom/core/dom/tuiElement";
import { ScrollableElement, type ScrollViewportInfo } from "@tuidom/elements/scrollbar/scrollableElement";

import { wrapIndented } from "../../hover/browser/hoverElement.ts";

/** Upstream's editor scrolls three lines a notch, as our editor. */
const WHEEL_LINES = 3;

/**
 * Upstream `PlainTextMessagePeek`/`MarkdownTestMessagePeek`'s text: read only, wrapped by words to the width, the
 * indentation of a line kept on its continuation lines (a code block, a stack), scrolled by the wheel. It takes the
 * keyboard as upstream's read-only editor does: the arrows, PageUp/PageDown, Home/End scroll it.
 */
export class TestMessageTextElement extends ScrollableElement {
    private text = "";
    // Stryker disable next-line ArrayDeclaration: equivalent — the first layout wraps the text before anything reads the lines
    private lines: readonly string[] = [];
    /** Nothing is wrapped yet: no width equals NaN. */
    private wrappedWidth = Number.NaN;

    public constructor() {
        super();
        this.focusable = true;
        this.addEventListener("wheel", (event) => {
            if (event.wheelDirection === "up") this.scrollBy(0, -WHEEL_LINES);
            else if (event.wheelDirection === "down") this.scrollBy(0, WHEEL_LINES);
        });
        this.addEventListener("keydown", (event) => {
            const page = Math.max(1, this.layoutSize.height - 1);
            const delta: Partial<Record<string, number>> = {
                ArrowUp: -1,
                ArrowDown: 1,
                PageUp: -page,
                PageDown: page,
                Home: -this.contentHeight,
                End: this.contentHeight,
            };
            const dy = delta[event.key];
            if (dy === undefined || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
            // Stryker disable next-line CallExpression: equivalent — no ancestor in the panel takes these keys; consumed as upstream's editor does
            event.preventDefault();
            this.scrollBy(0, dy);
        });
    }

    public setText(text: string): void {
        this.text = text;
        this.wrappedWidth = Number.NaN;
        this.scrollTo(0, 0);
    }

    public get contentHeight(): number {
        return this.lines.length;
    }

    // Stryker disable next-line BlockStatement: equivalent — the text wraps to the width and its bar has no horizontal one
    public get contentWidth(): number {
        return this.layoutSize.width;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const width = constraints.maxWidth;
        // Stryker disable next-line ConditionalExpression: equivalent — the same text wrapped at the same width gives the same lines; the check saves the work
        if (width !== this.wrappedWidth) {
            this.wrappedWidth = width;
            this.lines = this.text.split("\n").flatMap((line) => wrapIndented(line, width));
        }
        return super.performLayout(constraints);
    }

    protected override renderViewport(context: RenderContext, viewport: ScrollViewportInfo): void {
        const fg = this.styleVar("foreground");
        const { scrollTop, viewportHeight, viewportWidth } = viewport;
        for (const [row, line] of this.lines.slice(scrollTop, scrollTop + viewportHeight).entries()) {
            // Stryker disable next-line ObjectLiteral: equivalent — the lines are wrapped to the viewport's width
            context.drawText(0, row, line, { fg }, { maxWidth: viewportWidth });
        }
    }
}
