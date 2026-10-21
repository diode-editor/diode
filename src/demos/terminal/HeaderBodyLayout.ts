// Not VStackElement: it requires a fixed height for every child and cannot "take the rest".

import { BoxConstraints, Offset, Point, Rect, Size } from "@tuidom/core/common/geometryPromitives";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";

export class HeaderBodyLayout extends TUIElement {
    private readonly header: TUIElement;
    private readonly body: TUIElement;
    private readonly headerHeight: number;

    /** Horizontal body padding on each side: resizes the control without resizing the window. */
    public bodyPadX = 0;

    public constructor(header: TUIElement, body: TUIElement, headerHeight = 1) {
        super();
        this.header = header;
        this.body = body;
        this.headerHeight = headerHeight;
        this.appendChild(this.header);
        this.appendChild(this.body);
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const w = size.width;
        const h = size.height;
        const hh = Math.min(this.headerHeight, h);

        this.layoutChild(this.header, 0, 0, BoxConstraints.tight(new Size(w, hh)));

        const padX = Math.max(0, Math.min(this.bodyPadX, Math.floor((w - 1) / 2)));
        const bodyW = Math.max(0, w - 2 * padX);
        const bodyH = Math.max(0, h - hh);
        this.layoutChild(this.body, padX, hh, BoxConstraints.tight(new Size(bodyW, bodyH)));

        return size;
    }
}
