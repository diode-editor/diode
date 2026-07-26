import { packRgb } from "../../common/colorUtils.ts";
import { BoxConstraints, Size } from "../../common/geometryPromitives.ts";
import type { TUIEventBase } from "../../dom/events/tuiEventBase.ts";
import type { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";
import type { OverlaySessionHandle } from "../contextview/overlayLayer.ts";
import type { MenuEntry } from "../menu/popupMenuElement.ts";
import { PopupMenuElement } from "../menu/popupMenuElement.ts";
import type { IMenuStyles } from "../menu/popupMenuItemElement.tsx";
import { unthemedMenuStyles } from "../menu/popupMenuItemElement.tsx";

/** Шеврон закрытого состояния — тот же глиф, что у `<select>` в VS Code. */
const CHEVRON = "⌄"; // ⌄ DOWN ARROWHEAD
/** Отметка выбранного пункта в раскрытом списке (VS Code рисует галочку). */
const CHECK = "✓"; // ✓

/** Опция списка — форма зеркалит `ISelectOptionItem` из vscode. */
export interface ISelectOptionItem {
    readonly text: string;
    /** Разделитель: не выбирается, в списке рисуется чертой. */
    readonly isSeparator?: boolean;
}

/** Результат выбора — зеркалит `ISelectData` из vscode. */
export interface ISelectData {
    readonly selected: string;
    readonly index: number;
}

export interface ISelectBoxStyles {
    readonly selectForeground: number;
    readonly selectBackground: number;
    readonly selectBorder: number;
    /** Стили раскрытого списка (готовые цвета меню). */
    readonly list: IMenuStyles;
}

// Значения из vscode `unthemedSelectBoxStyles`; workbench перебивает их темой.
export const unthemedSelectBoxStyles: ISelectBoxStyles = {
    selectForeground: packRgb(0xf0, 0xf0, 0xf0),
    selectBackground: packRgb(0x3c, 0x3c, 0x3c),
    selectBorder: packRgb(0x3c, 0x3c, 0x3c),
    list: unthemedMenuStyles,
};

/**
 * Выпадающий список (аналог `SelectBox` из `base/browser/ui/selectBox/`).
 * Закрытое состояние — одна строка `текст ⌄`; раскрытие строит
 * {@link PopupMenuElement} и вешает его в overlay-слой корневой view — тем же
 * путём, что контекст-меню Explorer'а, поэтому клик мимо и Escape закрывают
 * список, а фокус возвращается сюда.
 */
export class SelectBoxElement extends TUIElement {
    private options: readonly ISelectOptionItem[] = [];
    private selectedIndex = -1;
    private styles: ISelectBoxStyles = unthemedSelectBoxStyles;
    private session: OverlaySessionHandle | null = null;

    /** Выбор пользователя. Программный {@link select} события не порождает. */
    public onDidSelect?: (data: ISelectData) => void;

    public constructor() {
        super();
        this.tabIndex = 0;
        this.addEventListener("mousedown", (event) => {
            if (event.button !== "left") return;
            this.toggleOpen();
        });
    }

    public setOptions(options: readonly ISelectOptionItem[], selected?: number): void {
        this.options = options;
        if (selected !== undefined) this.selectedIndex = selected;
        // Выбранный индекс мог указывать за пределы нового списка (канал исчез).
        if (this.selectedIndex >= options.length) this.selectedIndex = options.length - 1;
        this.markDirty();
    }

    /** Программно выставить выбор — без `onDidSelect`, как `select()` в vscode. */
    public select(index: number): void {
        if (index < 0 || index >= this.options.length) return;
        this.selectedIndex = index;
        this.markDirty();
    }

    public getSelected(): number {
        return this.selectedIndex;
    }

    /** Observable state: option texts, selected index/text, and open/closed. */
    public override inspectState(): Record<string, unknown> {
        return {
            open: this.isOpen(),
            selectedIndex: this.selectedIndex,
            selectedText: this.selectedText(),
            options: this.options.map((o) => o.text),
        };
    }

    public setStyles(styles: ISelectBoxStyles): void {
        this.styles = styles;
        this.markDirty();
    }

    public isOpen(): boolean {
        return this.session?.isOpen() ?? false;
    }

    /** Текст закрытого состояния: выбранная опция (или пусто, если выбора нет). */
    private selectedText(): string {
        const option = this.selectedIndex >= 0 ? this.options[this.selectedIndex] : undefined;
        return option?.text ?? "";
    }

    private contentWidth(): number {
        // Ширина не прыгает при смене выбора: держим её по самой длинной опции.
        const longest = this.options.reduce((max, o) => Math.max(max, o.text.length), 0);
        return Math.max(longest, this.selectedText().length) + CHEVRON.length + 1;
    }

    public override getMinIntrinsicWidth(_height: number): number {
        return this.contentWidth();
    }

    public override getMaxIntrinsicWidth(_height: number): number {
        return this.contentWidth();
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return 1;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return 1;
    }

    public override performLayout(constraints: BoxConstraints): Size {
        const width = constraints.constrain(new Size(this.contentWidth(), 1)).width;
        return super.performLayout(BoxConstraints.tight(new Size(width, 1)));
    }

    public override render(context: RenderContext): void {
        const width = this.layoutSize.width;
        const { selectForeground: fg, selectBackground: bg } = this.styles;
        const text = this.selectedText();

        for (let x = 0; x < width; x++) {
            context.setCell(x, 0, { char: " ", fg, bg });
        }
        for (let i = 0; i < text.length && i < width; i++) {
            context.setCell(i, 0, { char: text[i], fg, bg });
        }
        // Шеврон прижат вправо — так же, как стрелка нативного `<select>`.
        if (width > 0) {
            context.setCell(width - 1, 0, { char: CHEVRON, fg: this.styles.selectBorder, bg });
        }
    }

    protected override performDefaultAction(event: TUIEventBase): void {
        if (event.type === "keydown") {
            const key = (event as TUIKeyboardEvent).key;
            if (key === "Enter" || key === " " || key === "ArrowDown") {
                this.toggleOpen();
                return;
            }
        }
        super.performDefaultAction(event);
    }

    private toggleOpen(): void {
        if (this.isOpen()) {
            this.session?.close();
            return;
        }
        this.open();
    }

    private open(): void {
        const layer = this.getOverlayLayer();
        if (layer === null || this.options.length === 0) return;

        const entries: MenuEntry[] = this.options.map((option, index) => {
            if (option.isSeparator === true) return { type: "separator" };
            return {
                label: option.text,
                // Галочка у активного пункта — то же, что `toggled` в меню VS Code.
                icon: index === this.selectedIndex ? CHECK : " ",
                onSelect: () => {
                    this.session?.close();
                    this.selectedIndex = index;
                    this.markDirty();
                    this.onDidSelect?.({ selected: option.text, index });
                },
            };
        });

        const menu = new PopupMenuElement(entries);
        menu.setStyles(this.styles.list);
        menu.tabIndex = 0;
        // Список раскрывается ПОД контролом и прижимается к его левому краю —
        // как раскрывается `<select>`.
        this.session = layer.openPopupSession(
            menu,
            { screenX: this.globalPosition.x, screenY: this.globalPosition.y },
            {
                visible: true,
                restoreFocus: true,
                focusOnOpen: true,
                closeOnEscape: true,
                pointerPolicy: "close-on-outside",
                disposeOnClose: true,
                onClose: () => {
                    this.session = null;
                },
            },
        );
        menu.onClose = () => {
            this.session?.close();
        };
    }
}
