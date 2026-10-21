import { INHERITED_BG } from "@tuidom/core/dom/styles/tuiStyle";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { HeaderBodyViewElement } from "./headerBodyViewElement.ts";

export interface IFilteredListOptions {
    readonly viewId: string;
    readonly listId: string;
    readonly placeholder?: string;
    /** Off for filtered lists: typing goes to the input. */
    readonly typeahead?: boolean;
}

/**
 * Search box + list scaffold (Extensions, Keyboard Shortcuts). Owns only the wiring; the consumer
 * builds the rows (`list.clear()` + `list.appendRow(...)`).
 */
export class FilteredListControl {
    public readonly view: TUIElement;
    public readonly input = new InputElement();
    public readonly list: ListViewElement;

    public onQueryChange: ((query: string) => void) | null = null;
    /** List rows always have an id, so it is passed as non-null. */
    public onActivateRow: ((rowId: string) => void) | null = null;

    public constructor(options: IFilteredListOptions) {
        this.input.placeholder = options.placeholder;
        this.input.onChange = (value) => {
            this.onQueryChange?.(value);
        };

        this.list = new ListViewElement({ typeahead: options.typeahead ?? false });
        this.list.id = options.listId;
        this.list.onActivate = (element) => {
            // The consumer never adds rows without an id.
            const rowId = element.id;
            if (rowId === undefined) return;
            this.onActivateRow?.(rowId);
        };

        const header = new PaddingContainerElement(this.input, { left: 1, right: 1 });
        const root = new HeaderBodyViewElement(header, new ScrollBarDecorator(this.list));
        root.id = options.viewId;
        this.view = root;
    }

    public getQuery(): string {
        return this.input.inputState.value;
    }

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

    public showPlaceholderRow(id: string, text: string): void {
        const row = new TextLabelElement(text);
        row.id = id;
        row.setColors("descriptionForeground", INHERITED_BG);
        this.list.appendRow(row);
    }
}
