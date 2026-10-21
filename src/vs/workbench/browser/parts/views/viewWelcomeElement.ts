import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import type { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { wrapText } from "@tuidom/elements/completionlist/completionDetailsElement";

/**
 * Аналог строки `viewsWelcome` эталона. Пустая строка — текстовый блок с `text: ""`: зазоры
 * расставляет автор, а не раскладка, иначе «текст, под ним кнопка» и «текст, зазор, кнопка»
 * было бы не различить.
 */
export type IViewWelcomeBlock =
    | { readonly kind: "text"; readonly text: string }
    | {
          readonly kind: "button";
          readonly label: string;
          readonly command: string;
          readonly args?: readonly unknown[];
      };

/**
 * Колонка заголовка секции и строк дерева. У плоской подсказки отступа нет намеренно — в
 * панели она обрезалась бы, а welcome у самого края читается криво.
 */
const LEFT_PADDING = 1;

type WelcomeRow =
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "button"; readonly index: number };

/**
 * Текст рисуется сам, а не детьми-лейблами: перенос зависит от ширины из `performLayout`,
 * а менять там состав детей или текст прикреплённого лейбла нельзя — это замораживает кадр.
 * Поэтому дети — только кнопки.
 */
export class ViewWelcomeElement extends TUIElement {
    private readonly buttons: ButtonElement[] = [];

    public constructor(
        private readonly blocks: readonly IViewWelcomeBlock[],
        run: (command: string, args: readonly unknown[]) => void,
    ) {
        super();
        this.style = { fg: "descriptionForeground" };
        for (const block of blocks) {
            if (block.kind !== "button") continue;
            const button = new ButtonElement(block.label);
            const { command, args = [] } = block;
            button.onActivate = () => {
                run(command, args);
            };
            this.buttons.push(button);
            this.appendChild(button);
        }
    }

    /** `false` — кнопок нет, и куда деть фокус, решает вызывающий. */
    public focusFirstButton(): boolean {
        const first = this.buttons.at(0);
        if (first === undefined) return false;
        first.focus();
        return true;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const width = this.textWidth(size.width);
        const rows = this.rowsFor(width);
        for (const [y, row] of rows.entries()) {
            if (row.kind !== "button") continue;
            this.layoutChild(this.buttons[row.index], LEFT_PADDING, y, BoxConstraints.loose(new Size(width, 1)));
        }
        return size;
    }

    public override render(context: RenderContext): void {
        super.render(context);
        const { fg, bg } = this.resolvedStyle;
        const width = this.textWidth(this.layoutSize.width);
        const rows = this.rowsFor(width);
        for (const [y, row] of rows.entries()) {
            if (row.kind !== "text") continue;
            // Без `maxWidth`: строки уже перенесены под эту ширину, остальное обрежет клип секции.
            context.drawText(LEFT_PADDING, y, row.text, { fg, bg });
        }
    }

    private textWidth(available: number): number {
        return Math.max(0, available - LEFT_PADDING);
    }

    /** Без кэша: блоков единицы, а кэш по ширине дал бы ветку, наблюдаемую только по стоимости. */
    private rowsFor(width: number): readonly WelcomeRow[] {
        const rows: WelcomeRow[] = [];
        let buttonIndex = 0;
        for (const block of this.blocks) {
            if (block.kind === "button") {
                rows.push({ kind: "button", index: buttonIndex });
                buttonIndex++;
                continue;
            }
            // Зазор (`text: ""`): wrapText отдаёт на нём одну пустую строку.
            for (const line of wrapText(block.text, width)) rows.push({ kind: "text", text: line });
        }
        return rows;
    }
}
