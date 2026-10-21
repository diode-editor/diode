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

/** Readme в списке — ради прокрутки и виртуализации: он бывает на сотни строк. */
export class ExtensionPageElement extends TUIElement {
    // Typeahead не выключаем: строки страницы заводятся без `label`, а быстрый
    // поиск по ним и так не работает — опция была бы декорацией.
    private readonly list = new ListViewElement();
    private readonly header: ExtensionPageHeaderElement;
    private readonly root: HeaderBodyViewElement;
    private rows: TextLabelElement[] = [];
    private content: IExtensionPageContent;
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
        const body = new PaddingContainerElement(new ScrollBarDecorator(this.list), { left: 1 });
        this.root = new HeaderBodyViewElement(this.header, body);
        this.appendChild(this.root);
        this.addEventListener("keydown", (event) => {
            this.handleKeyDown(event);
        });
    }

    public setContent(content: IExtensionPageContent, buttons: readonly IExtensionButton[]): void {
        this.content = content;
        this.header.setContent(content, buttons);
        this.rebuildRows();
    }

    public override focus(): void {
        if (!this.header.focusFirstEnabledButton()) this.list.focus();
    }

    public override inspectState(): Record<string, unknown> {
        return { lines: this.rows.map((row) => row.getText()) };
    }

    // Ширина известна только в раскладке — строки пересобираются здесь, ДО раскладки тела, иначе первый
    // кадр вкладки пуст. Пересборка только на СМЕНУ ширины, поэтому кадры не зацикливаются.
    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        if (size.width !== this.wrappedWidth) {
            this.wrappedWidth = size.width;
            this.rebuildRows();
        }
        this.layoutChild(this.root, 0, 0, BoxConstraints.tight(size));
        return size;
    }

    /** `tab` занят отступом только при текстовом фокусе, которого у страницы нет. */
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
        if (this.wrappedWidth === null) return;
        // Минус колонка отступа слева и полосы прокрутки справа — иначе строка упиралась бы в бегунок.
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
