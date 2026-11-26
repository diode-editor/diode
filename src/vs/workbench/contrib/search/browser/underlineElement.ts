import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";

/**
 * A one-row rule under a search field. The fields have no background or frame (as in ttt): the line
 * is the only thing that marks where a field is.
 */
export class UnderlineElement extends TUIElement {
    public constructor() {
        super();
        this.style = { fg: "panel.border" };
    }

    public override render(context: RenderContext): void {
        const { fg, bg } = this.resolvedStyle;
        context.drawText(0, 0, "─".repeat(this.layoutSize.width), { fg, bg });
    }
}
