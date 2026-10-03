import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import type { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { wrapText } from "@tuidom/elements/completionlist/completionDetailsElement";

/**
 * Один блок пустого состояния view — аналог строки `viewsWelcome` эталона, где
 * абзац текста и ссылка-команда (`[label](command:id)`) тоже лежат одним
 * списком. Пустая строка выражается текстовым блоком с `text: ""`: зазоры
 * расставляет автор содержимого, а не раскладка — иначе «текст, под ним кнопка»
 * и «текст, зазор, кнопка» было бы не различить.
 */
export type IViewWelcomeBlock =
    | { readonly kind: "text"; readonly text: string }
    | {
          readonly kind: "button";
          readonly label: string;
          /** Команда, которую запускает кнопка (как `command:` у ссылки в эталоне). */
          readonly command: string;
          readonly args?: readonly unknown[];
      };

/**
 * Отступ слева, которым welcome встаёт в одну колонку с заголовком секции и
 * строками дерева (`TreeViewElement({ leftPadding: 1 })`). Плоская подсказка
 * его не имеет намеренно — её контент узкий и в панели обрезался бы, — а
 * welcome заметный, и уехавший к самому краю текст с кнопкой читается криво.
 */
const LEFT_PADDING = 1;

/** Строка раскладки: либо готовая (уже перенесённая) строка текста, либо кнопка. */
type WelcomeRow =
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "button"; readonly index: number };

/**
 * Интерактивное пустое состояние view (аналог `viewsWelcome` VS Code): абзацы
 * текста с переносом по словам и кнопки, запускающие команды.
 *
 * Текст элемент рисует сам, а не детьми-лейблами: перенос зависит от ширины,
 * которая известна только в `performLayout`, а менять там состав детей (или
 * текст уже прикреплённого лейбла) нельзя — это замораживает кадр. Поэтому
 * детей ровно столько, сколько кнопок, а строки текста считаются из ширины и
 * уходят прямо в `drawText`.
 *
 * Кнопки — обычные {@link ButtonElement}: фокусируемые, значит достижимые
 * Tab/Shift+Tab штатным обходом движка, Enter/Space их активируют. Фокус на
 * первую кнопку при показе секции ставит `ViewsService.focusContainer` через
 * {@link focusFirstButton} — чтобы из состояния «папка не открыта» выход был
 * одним нажатием.
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

    /**
     * Ставит фокус на первую кнопку. Возвращает `false`, если кнопок нет
     * (пустое состояние из одного текста) — тогда фокусировать нечего и
     * вызывающий решает сам, куда его деть.
     */
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
            // Кнопка шириной по метке (её `performLayout` сам жмётся к
            // натуральному размеру), поэтому constraints тут loose.
            this.layoutChild(this.buttons[row.index], LEFT_PADDING, y, BoxConstraints.loose(new Size(width, 1)));
        }
        return size;
    }

    public override render(context: RenderContext): void {
        // Сначала фон и дети (кнопки), потом строки текста: строки кнопок и
        // строки текста не пересекаются, так что порядок роли не играет.
        super.render(context);
        const { fg, bg } = this.resolvedStyle;
        const width = this.textWidth(this.layoutSize.width);
        const rows = this.rowsFor(width);
        for (const [y, row] of rows.entries()) {
            if (row.kind !== "text") continue;
            context.drawText(LEFT_PADDING, y, row.text, { fg, bg }, { maxWidth: width });
        }
    }

    /** Ширина под контент: всё, что осталось от секции за вычетом отступа. */
    private textWidth(available: number): number {
        return Math.max(0, available - LEFT_PADDING);
    }

    /**
     * Строки под ширину. Считается на каждый layout и render, без кэша: блоков
     * единицы, а кэш по ширине дал бы ветку, наблюдаемую только по стоимости.
     */
    private rowsFor(width: number): readonly WelcomeRow[] {
        const rows: WelcomeRow[] = [];
        let buttonIndex = 0;
        for (const block of this.blocks) {
            if (block.kind === "button") {
                rows.push({ kind: "button", index: buttonIndex });
                buttonIndex++;
                continue;
            }
            // Зазор (`text: ""`) проходит тем же путём: wrapText отдаёт на нём
            // одну пустую строку.
            for (const line of wrapText(block.text, width)) rows.push({ kind: "text", text: line });
        }
        return rows;
    }
}
