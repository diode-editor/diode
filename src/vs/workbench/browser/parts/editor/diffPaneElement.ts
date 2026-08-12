import { BoxConstraints, Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { RenderContext, TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";

/** Вертикальный разделитель колонок side-by-side. */
const COLUMN_SEPARATOR = "│";

/** Отступ подписи колонки от левого края её текстовой зоны. */
const LABEL_PADDING = 1;

/**
 * Ряд заголовков колонок — дети сдвинуты под него. Модульная константа, а не
 * статик класса: статическая само-ссылка заставляет esbuild переименовать класс
 * (`var X = class _X`), и `constructor.name` в бинаре перестаёт совпадать с
 * типом узла инспектора — e2e-селекторы слепнут.
 */
export const DIFF_HEADER_ROWS = 1;

/**
 * Контейнер дифф-вкладки v2: строка заголовков с подписями сторон (US-14:
 * `HEAD │ a.ts` — как в side-by-side первой смотрелки) и две колонки 50/50 с
 * колонкой-разделителем между ними. Дети — view двух сторон (настоящих
 * редакторов). Никаких сашей и весов: фиксированное пополам.
 */
export class DiffPaneElement extends TUIElement {
    public constructor(
        private readonly left: TUIElement,
        private readonly right: TUIElement,
        private readonly labels: { readonly original: string; readonly modified: string },
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
        const childHeight = Math.max(0, size.height - DIFF_HEADER_ROWS);
        this.layoutChild(
            this.left,
            0,
            DIFF_HEADER_ROWS,
            BoxConstraints.tight(new Size(separator, childHeight)),
        );
        this.layoutChild(
            this.right,
            separator + 1,
            DIFF_HEADER_ROWS,
            BoxConstraints.tight(new Size(rightWidth, childHeight)),
        );
        return size;
    }

    public render(context: RenderContext): void {
        const separator = this.separatorColumn;
        const fg = this.styleVar("editorLineNumber.foreground");
        const bg = this.resolvedStyle.bg;
        // Подписи колонок: обрезаются по ширине своей колонки, чтобы длинная
        // метка не переползла разделитель.
        const leftLabel = this.labels.original.slice(0, Math.max(0, separator - LABEL_PADDING));
        const rightWidth = Math.max(0, this.layoutSize.width - separator - 1);
        const rightLabel = this.labels.modified.slice(0, Math.max(0, rightWidth - LABEL_PADDING));
        context.drawText(LABEL_PADDING, 0, leftLabel, { fg, bg });
        context.drawText(separator + 1 + LABEL_PADDING, 0, rightLabel, { fg, bg });
        for (let y = 0; y < this.layoutSize.height; y++) {
            context.setCell(separator, y, { char: COLUMN_SEPARATOR, fg, bg, width: 1 });
        }
        this.renderChildren(context);
    }
}
