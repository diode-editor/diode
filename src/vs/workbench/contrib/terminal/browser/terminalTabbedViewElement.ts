import type { BoxConstraints } from "@tuidom/core/common/geometryPromitives";
import { BoxConstraints as Constraints, Size } from "@tuidom/core/common/geometryPromitives";
import type { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TUIElement } from "@tuidom/core/dom/tuiElement";

/** Разделитель между терминалом и списком вкладок — та же черта, что у колонок диффа. */
const DIVIDER = "│";

export type TerminalTabsLocation = "left" | "right";

/**
 * Тело вкладки TERMINAL (эталон `TerminalTabbedView`): виджет активного
 * терминала занимает остаток ширины, список вкладок — фиксированную колонку
 * сбоку (`terminal.integrated.tabs.location`), между ними черта `panel.border`.
 *
 * Контейнер стабилен на всё время жизни компонента: меняется только ребёнок-
 * терминал и видимость списка — так переключение активного терминала не
 * пересобирает тело секции панели.
 */
export class TerminalTabbedViewElement extends TUIElement {
    private terminal: TUIElement | null = null;
    private tabsOnLeft = false;

    public constructor(
        private readonly tabs: TUIElement,
        private readonly tabsWidth: number,
    ) {
        super();
        this.id = "terminalTabbedView";
        tabs.hidden = true;
        this.appendChild(tabs);
    }

    /** Подменить виджет терминала (null — терминалов нет). */
    public setTerminal(terminal: TUIElement | null): void {
        this.terminal = terminal;
        this.setChildren(terminal === null ? [this.tabs] : [this.tabs, terminal]);
    }

    /** Показать/спрятать список; перерисовку метит сам сеттер `hidden`. */
    public setTabsVisible(visible: boolean): void {
        this.tabs.hidden = !visible;
    }

    public get isTabsVisible(): boolean {
        return !this.tabs.hidden;
    }

    public setLocation(location: TerminalTabsLocation): void {
        const left = location === "left";
        if (this.tabsOnLeft === left) return;
        this.tabsOnLeft = left;
        this.markDirty();
    }

    /** Список не отнимает у терминала больше половины ширины. */
    private tabsColumns(width: number): number {
        return Math.min(this.tabsWidth, Math.floor(width / 2));
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const tabsWidth = this.isTabsVisible ? this.tabsColumns(size.width) : 0;
        // Черта-разделитель есть только вместе со списком.
        const dividerWidth = this.isTabsVisible ? 1 : 0;
        const terminalWidth = size.width - tabsWidth - dividerWidth;
        const tabsX = this.tabsOnLeft ? 0 : terminalWidth + dividerWidth;
        // Скрытый список раскладывать незачем, но и вреда нет — он не рисуется.
        this.layoutChild(this.tabs, tabsX, 0, Constraints.tight(new Size(tabsWidth, size.height)));
        if (this.terminal !== null) {
            const terminalX = this.tabsOnLeft ? tabsWidth + dividerWidth : 0;
            this.layoutChild(this.terminal, terminalX, 0, Constraints.tight(new Size(terminalWidth, size.height)));
        }
        return size;
    }

    public override render(context: RenderContext): void {
        this.renderChildren(context);
        if (!this.isTabsVisible) return;
        const width = this.layoutSize.width;
        const column = this.tabsOnLeft ? this.tabsColumns(width) : width - this.tabsColumns(width) - 1;
        const fg = this.styleVar("panel.border");
        const bg = this.resolvedStyle.bg;
        for (let y = 0; y < this.layoutSize.height; y++) {
            context.setCell(column, y, { char: DIVIDER, fg, bg, width: 1 });
        }
    }
}
