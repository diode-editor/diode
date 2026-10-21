import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIElement } from "@tuidom/core/dom/tuiElement";

/**
 * Шапка натуральной высоты сверху, остаток — телу. `VStackElement` так не умеет (ряды
 * фиксированной высоты), а шапка обязана дышать: Search раскрывает блок include/exclude.
 */
export class HeaderBodyViewElement extends TUIElement {
    public constructor(
        private readonly header: TUIElement,
        private readonly body: TUIElement,
    ) {
        super();
        this.appendChild(header);
        this.appendChild(body);
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const headerHeight = Math.min(size.height, this.header.getMaxIntrinsicHeight(size.width));
        const bodyHeight = Math.max(0, size.height - headerHeight);

        this.layoutChild(this.header, 0, 0, BoxConstraints.tight(new Size(size.width, headerHeight)));
        this.layoutChild(this.body, 0, headerHeight, BoxConstraints.tight(new Size(size.width, bodyHeight)));
        return size;
    }
}
