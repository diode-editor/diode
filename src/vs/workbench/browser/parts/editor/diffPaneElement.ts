import { BoxConstraints, Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { RenderContext, TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";

/** Вертикальный разделитель колонок side-by-side. */
const COLUMN_SEPARATOR = "│";

/**
 * Контейнер дифф-вкладки v2: две колонки 50/50 с колонкой-разделителем между
 * ними. Дети — view двух сторон (настоящих редакторов). Никаких сашей и
 * весов (это PR-5): фиксированное пополам, как у первой версии сплитов.
 */
export class DiffPaneElement extends TUIElement {
    public constructor(
        private readonly left: TUIElement,
        private readonly right: TUIElement,
    ) {
        super();
        this.appendChild(left);
        this.appendChild(right);
    }

    /** X колонки-разделителя при текущей ширине. */
    public get separatorColumn(): number {
        return Math.floor((this.layoutSize.width - 1) / 2);
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const separator = Math.floor((size.width - 1) / 2);
        const rightWidth = Math.max(0, size.width - separator - 1);
        this.layoutChild(this.left, 0, 0, BoxConstraints.tight(new Size(separator, size.height)));
        this.layoutChild(this.right, separator + 1, 0, BoxConstraints.tight(new Size(rightWidth, size.height)));
        return size;
    }

    public render(context: RenderContext): void {
        const separator = this.separatorColumn;
        const fg = this.styleVar("editorLineNumber.foreground");
        const bg = this.resolvedStyle.bg;
        for (let y = 0; y < this.layoutSize.height; y++) {
            context.setCell(separator, y, { char: COLUMN_SEPARATOR, fg, bg, width: 1 });
        }
        this.renderChildren(context);
    }
}
