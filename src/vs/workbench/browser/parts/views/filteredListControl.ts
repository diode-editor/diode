import { INHERITED_BG } from "@tuidom/core/dom/styles/tuiStyle";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { HeaderBodyViewElement } from "./headerBodyViewElement.ts";

export interface IFilteredListOptions {
    /** Id корневого элемента (селекторы инспектора/e2e). */
    readonly viewId: string;
    readonly listId: string;
    readonly placeholder?: string;
    /** Typeahead списка; у фильтруемых списков выключен — печать уходит в input. */
    readonly typeahead?: boolean;
}

/**
 * Связка «строка запроса + виртуализованный список»: input в шапке
 * ({@link HeaderBodyViewElement}), тело — {@link ListViewElement} со скроллбаром.
 * Общий каркас вьюлетов и вкладок вида «поиск + список» (Extensions, Keyboard
 * Shortcuts); вынесен на третьем потребителе по конвенции #291.
 *
 * Контрол владеет только проводкой: запрос → {@link onQueryChange}, активация
 * строки → {@link onActivateRow}. Сами строки строит потребитель (`list.clear()`
 * + `list.appendRow(...)`) — модель данных и вёрстка строк остаются за ним.
 */
export class FilteredListControl {
    public readonly view: TUIElement;
    /** Публичны для фокус-команд и тестов (конвенция SearchComponent/ExtensionsComponent). */
    public readonly input = new InputElement();
    public readonly list: ListViewElement;

    public onQueryChange: ((query: string) => void) | null = null;
    /** Активация строки (Enter/двойной клик); id у строк списка обязателен, прокидывается non-null. */
    public onActivateRow: ((rowId: string) => void) | null = null;

    public constructor(options: IFilteredListOptions) {
        this.input.placeholder = options.placeholder;
        this.input.onChange = (value) => {
            this.onQueryChange?.(value);
        };

        this.list = new ListViewElement({ typeahead: options.typeahead ?? false });
        this.list.id = options.listId;
        this.list.onActivate = (element) => {
            // Список не принимает строки без id — здесь он гарантированно есть.
            this.onActivateRow?.(element.id!);
        };

        const header = new PaddingContainerElement(this.input, { left: 1, right: 1 });
        const root = new HeaderBodyViewElement(header, new ScrollBarDecorator(this.list));
        root.id = options.viewId;
        this.view = root;
    }

    public getQuery(): string {
        return this.input.inputState.value;
    }

    /** Ставит запрос программно (фильтр из команды/меню) и прогоняет его через onQueryChange. */
    public setQuery(value: string): void {
        this.input.inputState.value = value;
        this.onQueryChange?.(value);
    }

    public focusInput(): void {
        this.input.focus();
    }

    public focusList(): void {
        this.list.focus();
    }

    /** Строка-заглушка пустого состояния («No … found», «Loading…») приглушённым цветом. */
    public showPlaceholderRow(id: string, text: string): void {
        const row = new TextLabelElement(text);
        row.id = id;
        row.setColors("descriptionForeground", INHERITED_BG);
        this.list.appendRow(row);
    }
}
