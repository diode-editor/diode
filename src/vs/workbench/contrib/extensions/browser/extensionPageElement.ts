import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { INHERITED_BG } from "@tuidom/core/dom/styles/tuiStyle";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { HeaderBodyViewElement } from "../../../browser/parts/views/headerBodyViewElement.ts";

import type { ExtensionButtonKind, IExtensionButton } from "./extensionPageButtons.ts";
import type { IExtensionPageContent } from "./extensionPageContent.ts";
import { buildExtensionBodyLines, TONE_COLORS } from "./extensionPageContent.ts";
import { ExtensionPageHeaderElement } from "./extensionPageHeaderElement.ts";

/**
 * Вкладка расширения: закреплённая шапка с кнопками
 * ({@link ExtensionPageHeaderElement}) и readme в виртуализирующем списке.
 * Список выбран не ради интерактива, а ради прокрутки и виртуализации: readme
 * бывает на сотни строк, а рисовать надо только окно.
 *
 * Перенос по словам зависит от ширины, поэтому строки пересобираются при её
 * смене — прямо в раскладке (см. {@link performLayout}).
 */
export class ExtensionPageElement extends TUIElement {
    // Typeahead не выключаем: строки страницы заводятся без `label`, а быстрый
    // поиск по ним и так не работает — опция была бы декорацией.
    private readonly list = new ListViewElement();
    private readonly header: ExtensionPageHeaderElement;
    private readonly root: HeaderBodyViewElement;
    /** Строки readme как они показаны — источник для {@link inspectState}. */
    private rows: TextLabelElement[] = [];
    private content: IExtensionPageContent;
    /** Ширина, под которую посчитан текущий перенос; `null` — строк ещё нет. */
    private wrappedWidth: number | null = null;

    public constructor(
        content: IExtensionPageContent,
        buttons: readonly IExtensionButton[],
        onActivateButton: (kind: ExtensionButtonKind) => void,
    ) {
        super();
        this.content = content;
        this.list.id = "extensionPageLines";
        this.header = new ExtensionPageHeaderElement(content, buttons, onActivateButton);
        this.header.id = "extensionPageHeader";
        // Отступ слева — как у списков сайдбара: текст не прижат к рамке вкладки.
        const body = new PaddingContainerElement(new ScrollBarDecorator(this.list), { left: 1 });
        this.root = new HeaderBodyViewElement(this.header, body);
        this.appendChild(this.root);
        this.addEventListener("keydown", (event) => {
            this.handleKeyDown(event);
        });
    }

    /** Свежие данные страницы (сменилось состояние расширения, доехала мета). */
    public setContent(content: IExtensionPageContent, buttons: readonly IExtensionButton[]): void {
        this.content = content;
        this.header.setContent(content, buttons);
        this.rebuildRows();
    }

    /** Фокус — на первое доступное действие; действий нет — в текст readme. */
    public override focus(): void {
        if (!this.header.focusFirstEnabledButton()) this.list.focus();
    }

    /** Строки readme как они сейчас показаны — наблюдаемость для тестов и инспектора. */
    public override inspectState(): Record<string, unknown> {
        return { lines: this.rows.map((row) => row.getText()) };
    }

    /**
     * Перенос считается по ширине, а ширина известна только в раскладке —
     * поэтому строки пересобираются здесь, ДО раскладки тела: так новые строки
     * получают layout в этом же проходе и первый же кадр вкладки полон
     * (отложить пересборку в микротаск значило бы показать пустую страницу).
     * Пересборка идёт только на СМЕНУ ширины, поэтому кадры не зацикливаются.
     */
    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        if (size.width !== this.wrappedWidth) {
            this.wrappedWidth = size.width;
            this.rebuildRows();
        }
        this.layoutChild(this.root, 0, 0, BoxConstraints.tight(size));
        return size;
    }

    /**
     * Клавиатура страницы (приём модальных диалогов): стрелками — по ряду
     * кнопок, Tab — между кнопками и текстом. Глобальным биндингам это не
     * мешает: `tab` занят отступом только при текстовом фокусе, которого у
     * страницы нет.
     */
    private handleKeyDown(event: TUIKeyboardEvent): void {
        const buttons = this.header.getButtons();
        const focused = buttons.findIndex((button) => button.isFocused);
        switch (event.key) {
            case "ArrowLeft":
                if (focused > 0) {
                    event.preventDefault();
                    buttons[focused - 1].focus();
                }
                break;
            case "ArrowRight":
                if (focused !== -1 && focused < buttons.length - 1) {
                    event.preventDefault();
                    buttons[focused + 1].focus();
                }
                break;
            case "Tab":
                event.preventDefault();
                if (focused === -1) this.header.focusFirstEnabledButton();
                else this.list.focus();
                break;
        }
    }

    private rebuildRows(): void {
        // До первой раскладки ширины нет — и строк тоже: перенос без ширины
        // посчитать не из чего.
        if (this.wrappedWidth === null) return;
        // Ширина текста: минус колонка отступа слева и колонка полосы прокрутки
        // справа — иначе длинная строка упиралась бы в бегунок.
        const textWidth = this.wrappedWidth - 2;
        this.list.clear();
        this.rows = buildExtensionBodyLines(this.content, textWidth).map((line, i) => {
            const row = new TextLabelElement(line.text);
            row.id = `extensionPageLine-${String(i)}`;
            row.setColors(TONE_COLORS[line.tone], INHERITED_BG);
            this.list.appendRow(row);
            return row;
        });
    }
}

