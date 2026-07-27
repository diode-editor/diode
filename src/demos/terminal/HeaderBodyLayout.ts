// Крошечный демо-контейнер: фиксированной высоты «шапка» сверху + тело на остаток высоты.
//
// VStackElement требует фиксированную высоту у каждого ребёнка и не умеет «занять остаток»,
// а нам нужен тулбар в 1 строку и терминал на всё остальное. Паттерн layout/render —
// как в VStackElement/HFlexElement. Дополнительно `bodyPadX` inset'ит тело по горизонтали
// (демонстрация ресайза контрола без изменения окна).

import { BoxConstraints, Offset, Point, Rect, Size } from "../../../tuidom/common/geometryPromitives.ts";
import { RenderContext, TUIElement } from "../../../tuidom/dom/tuiElement.ts";

export class HeaderBodyLayout extends TUIElement {
    private readonly header: TUIElement;
    private readonly body: TUIElement;
    private readonly headerHeight: number;

    /** Горизонтальный отступ тела с каждой стороны (для демо ресайза). */
    public bodyPadX = 0;

    public constructor(header: TUIElement, body: TUIElement, headerHeight = 1) {
        super();
        this.header = header;
        this.body = body;
        this.headerHeight = headerHeight;
        this.appendChild(this.header);
        this.appendChild(this.body);
    }

    public override performLayout(constraints: BoxConstraints): Size {
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

    public override render(context: RenderContext): void {
        for (const child of this.getChildren()) {
            const offset = new Offset(child.localPosition.dx, child.localPosition.dy);
            const clip = new Rect(child.globalPosition, child.layoutSize);
            child.render(context.withOffset(offset).withClip(clip));
        }
    }
}
