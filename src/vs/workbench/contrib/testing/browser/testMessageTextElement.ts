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
    private lines: readonly string[] = [];
    private wrappedWidth = -1;

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
            event.preventDefault();
            this.scrollBy(0, dy);
        });
    }

    public setText(text: string): void {
        this.text = text;
        this.wrappedWidth = -1;
        this.scrollTo(0, 0);
        this.markDirty();
    }

    public get contentHeight(): number {
        return this.lines.length;
    }

    public get contentWidth(): number {
        return this.layoutSize.width;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const width = constraints.maxWidth;
        if (width !== this.wrappedWidth) {
            this.wrappedWidth = width;
            this.lines = this.text.split("\n").flatMap((line) => wrapIndented(line, width));
        }
        return super.performLayout(constraints);
    }

    protected override renderViewport(context: RenderContext, viewport: ScrollViewportInfo): void {
        const fg = this.styleVar("foreground");
        for (let row = 0; row < viewport.viewportHeight; row++) {
            const line = this.lines.at(viewport.scrollTop + row);
            if (line === undefined) return;
            context.drawText(0, row, line, { fg }, { maxWidth: viewport.viewportWidth });
        }
    }
}
