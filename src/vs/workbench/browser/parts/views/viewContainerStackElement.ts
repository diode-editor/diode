import type { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { VFlexElement, vflexFill, vflexFixed } from "@tuidom/elements/layout/vFlexElement";

import type { IFrameJointSource } from "../frameElement.ts";
import { isFrameJointSource } from "../frameElement.ts";

/** A horizontal line across its width, in the color of the part frames. */
export class HorizontalLineElement extends TUIElement {
    public override render(context: RenderContext): void {
        const fg = this.styleVar("panel.border");
        const bg = this.resolvedStyle.bg;
        for (let x = 0; x < this.layoutSize.width; x++) context.setCell(x, 0, { char: "─", fg, bg });
    }
}

/**
 * A sidebar view container: its header (title and buttons) in a band of its own, a line, then the
 * sections. Without a header (a merged container: its only section's header stands for it) — the
 * sections alone. The line and the sections' own separators meet the sidebar's frame
 * ({@link getFrameJointRows}).
 */
export class ViewContainerStackElement extends VFlexElement implements IFrameJointSource {
    private readonly line = new HorizontalLineElement();
    private header: TUIElement | null = null;
    private sections: TUIElement | null = null;

    public constructor() {
        super();
        this.line.layoutStyle = { height: vflexFixed(1), width: "fill" };
    }

    public setParts(header: TUIElement | null, sections: TUIElement): void {
        this.header = header;
        this.sections = sections;
        if (header !== null) header.layoutStyle = { height: vflexFixed(1), width: "fill" };
        sections.layoutStyle = { height: vflexFill(), width: "fill" };
        this.replaceChildren(header === null ? [sections] : [header, this.line, sections]);
    }

    public getFrameJointRows(): readonly number[] {
        const rows: number[] = [];
        if (this.header !== null) rows.push(this.line.localPosition.dy);
        const sections = this.sections;
        if (sections !== null && isFrameJointSource(sections)) {
            const top = sections.localPosition.dy;
            for (const row of sections.getFrameJointRows()) rows.push(top + row);
        }
        return rows;
    }
}
