import { DisplayLine } from "@tuidom/core/common/displayLine";
import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { BORDER_THICKNESS } from "@tuidom/core/dom/borderStyle";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";

/** Один на запрос, сообщение и строки списка: разные литералы сдвигали запрос относительно результатов. */
export const CONTENT_PAD = 1;

/**
 * Заголовок, врезанный в рамку (`┤ Save As ├`), и сепаратор на заданной строке —
 * то, чего не умеет движковый `BoxContainerElement`. Отступы контента рамка не
 * считает: их задаёт `PaddingContainerElement` внутри.
 */
export class QuickPickFrameElement extends TUIElement {
    private readonly child: TUIElement;
    private titleValue: string | undefined = undefined;
    /** В координатах элемента; null — не рисовать. */
    private separatorRowValue: number | null = null;

    public constructor(child: TUIElement) {
        super();
        this.child = child;
        this.appendChild(child);
    }

    public get title(): string | undefined {
        return this.titleValue;
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
        const inner = new Size(
            Math.max(0, size.width - BORDER_THICKNESS * 2),
            Math.max(0, size.height - BORDER_THICKNESS * 2),
        );
        this.layoutChild(this.child, BORDER_THICKNESS, BORDER_THICKNESS, BoxConstraints.tight(inner));
        return size;
    }

    public override render(context: RenderContext): void {
        const w = this.layoutSize.width;
        const h = this.layoutSize.height;
        if (w < BORDER_THICKNESS * 2 || h < BORDER_THICKNESS * 2) return;

        const border = this.styleVar("quickPick.border");
        const background = this.styleVar("quickInput.background");

        // Сепаратор — часть бокса, а не отдельный цикл: строка-распорка фон не красит,
        // и линия видна из-под детей.
        const separator = this.separatorRowValue;
        const separators = separator !== null && separator > 0 && separator < h - 1 ? [separator] : undefined;
        context.drawBox(0, 0, w, h, { fg: border, bg: background, fill: true, separators });

        const title = this.titleValue;
        if (title !== undefined && title !== "") {
            this.renderTitle(context, title, w, background, border);
        }

        this.renderChildren(context);
    }

    private renderTitle(context: RenderContext, title: string, w: number, background: number, border: number): void {
        const label = ` ${title} `;
        const labelWidth = new DisplayLine(label).displayWidth;
        // Две «крышки» плюс углы рамки.
        if (labelWidth + 4 > w) return;
        const startX = Math.max(2, Math.floor((w - labelWidth) / 2));
        context.setCell(startX - 1, 0, { char: "┤", fg: border, bg: background });
        context.drawText(startX, 0, label, { fg: this.styleVar("quickPick.titleForeground"), bg: background });
        context.setCell(startX + labelWidth, 0, { char: "├", fg: border, bg: background });
    }
}
