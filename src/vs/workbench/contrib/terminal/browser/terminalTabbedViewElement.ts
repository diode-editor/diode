import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
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
    private tabsVisible = false;
    private location: TerminalTabsLocation = "right";

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
        if (this.terminal === terminal) return;
        if (this.terminal !== null) this.removeChild(this.terminal);
        this.terminal = terminal;
        if (terminal !== null) this.appendChild(terminal);
        this.markDirty();
    }

    public setTabsVisible(visible: boolean): void {
        if (this.tabsVisible === visible) return;
        this.tabsVisible = visible;
        this.tabs.hidden = !visible;
        this.markDirty();
    }

    public get isTabsVisible(): boolean {
        return this.tabsVisible;
    }

    public setLocation(location: TerminalTabsLocation): void {
        if (this.location === location) return;
        this.location = location;
        this.markDirty();
    }

    /** Колонка черты-разделителя (null — списка нет). */
    private get dividerColumn(): number | null {
        if (!this.tabsVisible) return null;
        const width = this.layoutSize.width;
        return this.location === "left" ? this.tabsColumns(width) : width - this.tabsColumns(width) - 1;
    }

    /** Список не отнимает у терминала больше половины ширины. */
    private tabsColumns(width: number): number {
        return Math.max(0, Math.min(this.tabsWidth, Math.floor(width / 2)));
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const tabsWidth = this.tabsVisible ? this.tabsColumns(size.width) : 0;
        const dividerWidth = this.tabsVisible ? 1 : 0;
        const terminalWidth = Math.max(0, size.width - tabsWidth - dividerWidth);
        const left = this.location === "left";
        if (this.tabsVisible) {
            const tabsX = left ? 0 : terminalWidth + dividerWidth;
            this.layoutChild(this.tabs, tabsX, 0, BoxConstraints.tight(new Size(tabsWidth, size.height)));
        }
        if (this.terminal !== null) {
            const terminalX = left ? tabsWidth + dividerWidth : 0;
            this.layoutChild(this.terminal, terminalX, 0, BoxConstraints.tight(new Size(terminalWidth, size.height)));
        }
        return size;
    }

    public override render(context: RenderContext): void {
        this.renderChildren(context);
        const column = this.dividerColumn;
        if (column === null) return;
        const fg = this.styleVar("panel.border");
        const bg = this.resolvedStyle.bg;
        for (let y = 0; y < this.layoutSize.height; y++) {
            context.setCell(column, y, { char: DIVIDER, fg, bg, width: 1 });
        }
    }
}
