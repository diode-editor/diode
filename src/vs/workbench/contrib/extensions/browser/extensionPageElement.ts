import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import { INHERITED_BG, INHERITED_FG } from "@tuidom/core/dom/styles/tuiStyle";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import type { ExtensionPageTone, IExtensionPageContent } from "./extensionPageContent.ts";
import { buildExtensionPageLines } from "./extensionPageContent.ts";

/**
 * Тело вкладки расширения: строки {@link buildExtensionPageLines} в
 * виртуализирующем списке. Список выбран не ради интерактива, а ради прокрутки
 * и виртуализации: readme бывает на сотни строк, а рисовать надо только окно.
 *
 * Перенос по словам зависит от ширины, поэтому строки пересобираются при её
 * смене — прямо в раскладке (см. {@link performLayout}).
 */
export class ExtensionPageElement extends TUIElement {
    private readonly list = new ListViewElement({ typeahead: false });
    private readonly body: TUIElement;
    /** Строки как они показаны — источник для {@link inspectState}: у списка построчного чтения нет. */
    private rows: TextLabelElement[] = [];
    private content: IExtensionPageContent;
    /** Ширина, под которую посчитан текущий перенос; -1 — строк ещё нет. */
    private wrappedWidth = -1;

    public constructor(content: IExtensionPageContent) {
        super();
        this.content = content;
        this.list.id = "extensionPageLines";
        // Отступ слева — как у списков сайдбара: текст не прижат к рамке вкладки.
        this.body = new PaddingContainerElement(new ScrollBarDecorator(this.list), { left: 1 });
        this.appendChild(this.body);
    }

    /** Свежие данные страницы (сменилось состояние расширения, доехала мета). */
    public setContent(content: IExtensionPageContent): void {
        this.content = content;
        this.rebuildRows();
    }

    public override focus(): void {
        this.list.focus();
    }

    /** Строки как они сейчас показаны — наблюдаемость для тестов и инспектора. */
    public override inspectState(): Record<string, unknown> {
        return { lines: this.rows.map((row) => row.getText()) };
    }

    /**
     * Перенос считается по ширине, а ширина известна только в раскладке —
     * поэтому строки пересобираются здесь, ДО раскладки списка: так новые
     * строки получают layout в этом же проходе и первый же кадр вкладки полон
     * (отложить пересборку в микротаск значило бы показать пустую страницу).
     * Пересборка идёт только на СМЕНУ ширины, поэтому кадры не зацикливаются.
     */
    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        if (size.width !== this.wrappedWidth) {
            this.wrappedWidth = size.width;
            this.rebuildRows();
        }
        this.layoutChild(this.body, 0, 0, BoxConstraints.tight(size));
        return size;
    }

    private rebuildRows(): void {
        // Ширина текста: минус колонка отступа слева и колонка полосы прокрутки
        // справа — иначе длинная строка упиралась бы в бегунок.
        const textWidth = this.wrappedWidth - 2;
        this.list.clear();
        this.rows = buildExtensionPageLines(this.content, textWidth).map((line, i) => {
            const row = new TextLabelElement(line.text);
            row.id = `extensionPageLine-${String(i)}`;
            row.setColors(TONE_COLORS[line.tone], INHERITED_BG);
            this.list.appendRow(row);
            return row;
        });
    }
}

/** Тон → цвет. Таблицей, а не switch: тон здесь — данные, и читать их проще рядом. */
const TONE_COLORS: Record<ExtensionPageTone, StyleColor> = {
    normal: INHERITED_FG,
    dim: "descriptionForeground",
    warning: "editorWarning.foreground",
};
