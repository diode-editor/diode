import { DisplayLine } from "@tuidom/core/common/displayLine";
import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { BORDER_THICKNESS } from "@tuidom/core/dom/borderStyle";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";

/**
 * Отступ между рамкой и контентом — ОДИН на строку запроса, сообщение и строки
 * списка. Раньше он был тремя независимыми литералами в разных местах render'а,
 * отчего текст запроса ехал на символ левее результатов.
 */
export const CONTENT_PAD = 1;

/**
 * Хром пикера: рамка, врезанный в верхнюю границу заголовок (`┤ Save As ├`) и
 * сепаратор с T-коннекторами на заданной строке. Ровно то, чего не умеет
 * движковый `BoxContainerElement` (у него заголовок — отдельная строка внутри
 * рамки, а сепаратор жёстко на строке 2), и ровно то, ради чего
 * docs/arch/Workbench.md разрешает элементу жить рядом со своим компонентом.
 *
 * Содержимое — ЕДИНСТВЕННЫЙ ребёнок, разложенный внутри рамки. Отступы контента
 * рамка не считает: их задаёт `PaddingContainerElement` внутри, одним местом.
 */
export class QuickPickFrameElement extends TUIElement {
    private child: TUIElement | null = null;
    private titleValue: string | undefined = undefined;
    /** Строка (в координатах элемента), на которой рисовать `├───┤`; null — не рисовать. */
    private separatorRowValue: number | null = null;

    public setChild(child: TUIElement | null): void {
        if (this.child) this.removeChild(this.child);
        this.child = child;
        if (this.child) this.appendChild(this.child);
        this.markDirty();
    }

    public setTitle(value: string | undefined): void {
        if (this.titleValue === value) return;
        this.titleValue = value;
        this.markDirty();
    }

    public setSeparatorRow(value: number | null): void {
        if (this.separatorRowValue === value) return;
        this.separatorRowValue = value;
        this.markDirty();
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        if (this.child) {
            const inner = new Size(
                Math.max(0, size.width - BORDER_THICKNESS * 2),
                Math.max(0, size.height - BORDER_THICKNESS * 2),
            );
            this.layoutChild(this.child, BORDER_THICKNESS, BORDER_THICKNESS, BoxConstraints.tight(inner));
        }
        return size;
    }

    public override render(context: RenderContext): void {
        const w = this.layoutSize.width;
        const h = this.layoutSize.height;
        // Не помещается даже рамка — рисовать нечего.
        if (w < BORDER_THICKNESS * 2 || h < BORDER_THICKNESS * 2) return;

        const border = this.styleVar("quickPick.border");
        const background = this.styleVar("quickInput.background");

        // Сепаратор — часть бокса (T-коннекторы ├ ┤ ставит drawBox), а не
        // отдельный цикл: строка-распорка внутри контента фон не красит, поэтому
        // линия остаётся видна из-под детей.
        const separator = this.separatorRowValue;
        const separators = separator !== null && separator > 0 && separator < h - 1 ? [separator] : undefined;
        context.drawBox(0, 0, w, h, { fg: border, bg: background, fill: true, separators });

        if (this.titleValue !== undefined && this.titleValue !== "") {
            this.renderTitle(context, w, background, border);
        }

        this.renderChildren(context);
    }

    /** Заголовок по центру верхней рамки: `┤ title ├`. */
    private renderTitle(context: RenderContext, w: number, background: number, border: number): void {
        const label = ` ${this.titleValue ?? ""} `;
        const labelWidth = new DisplayLine(label).displayWidth;
        // Нужно место под две «крышки» плюс углы рамки.
        if (labelWidth + 4 > w) return;
        const startX = Math.max(2, Math.floor((w - labelWidth) / 2));
        context.setCell(startX - 1, 0, { char: "┤", fg: border, bg: background });
        context.drawText(startX, 0, label, { fg: this.styleVar("quickPick.titleForeground"), bg: background });
        context.setCell(startX + labelWidth, 0, { char: "├", fg: border, bg: background });
    }
}
