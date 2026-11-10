import type { BoxConstraints } from "@tuidom/core/common/geometryPromitives";
import { BoxConstraints as Constraints, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { SashElement } from "@tuidom/elements/sash/sashElement";

export type TerminalTabsLocation = "left" | "right";

/** Upstream `TerminalTabsListSizes.WideViewMinimumWidth` 80px; we have no narrow (icons only) mode below it. */
const TERMINAL_TABS_MIN_WIDTH = 10;
/** Upstream `TerminalTabsListSizes.MaximumWidth` 500px. */
const TERMINAL_TABS_MAX_WIDTH = 62;
/** Upstream terminal `minimumSize` 120px. */
const TERMINAL_MIN_WIDTH = 15;

/**
 * The tab list width laid out in a panel `width` columns wide: `desired` clamped to
 * [{@link TERMINAL_TABS_MIN_WIDTH}, {@link TERMINAL_TABS_MAX_WIDTH}] leaving the terminal
 * {@link TERMINAL_MIN_WIDTH}; where even the minimum list doesn't fit, half of the panel at most.
 */
export function terminalTabsColumns(desired: number, width: number): number {
    const max =
        width >= TERMINAL_TABS_MIN_WIDTH + 1 + TERMINAL_MIN_WIDTH
            ? Math.min(TERMINAL_TABS_MAX_WIDTH, width - 1 - TERMINAL_MIN_WIDTH)
            : Math.floor(width / 2);
    return Math.min(Math.max(desired, TERMINAL_TABS_MIN_WIDTH), max);
}

/**
 * The container is stable: only the terminal child and list visibility change —
 * switching terminals doesn't rebuild the panel section body.
 *
 * Upstream `TerminalTabbedView`: a split view with `proportionalLayout: false` — the list keeps
 * its width when the panel resizes, the terminal takes the rest. The divider column between them
 * is a sash: drag resizes the list, double-click fits it to the longest tab ({@link onDidResetTabsWidth}).
 */
export class TerminalTabbedViewElement extends TUIElement {
    private terminal: TUIElement | null = null;
    private tabsOnLeft = false;
    private readonly sash = new SashElement("vertical");

    /** A drag changed {@link tabsWidth}; the owner persists it. */
    public onDidChangeTabsWidth?: (width: number) => void;
    /** Double-click on the sash. */
    public onDidResetTabsWidth?: () => void;

    public constructor(
        private readonly tabs: TUIElement,
        /** What the user set; clamped only in layout ({@link terminalTabsColumns}). */
        private tabsWidth: number,
    ) {
        super();
        this.id = "terminalTabbedView";
        tabs.hidden = true;
        this.sash.hidden = true;
        this.sash.restColorVar = "panel.border";
        this.sash.onDrag = (boundaryScreenX) => {
            const left = this.globalPosition.x;
            const columns = this.tabsOnLeft
                ? boundaryScreenX - left
                : left + this.layoutSize.width - boundaryScreenX - 1;
            this.setTabsWidth(terminalTabsColumns(columns, this.layoutSize.width));
            this.onDidChangeTabsWidth?.(this.tabsWidth);
        };
        this.sash.addEventListener("dblclick", () => {
            this.onDidResetTabsWidth?.();
        });
        this.setChildren([tabs, this.sash]);
    }

    public setTerminal(terminal: TUIElement | null): void {
        this.terminal = terminal;
        this.setChildren(terminal === null ? [this.tabs, this.sash] : [this.tabs, terminal, this.sash]);
    }

    /** The `hidden` setter itself marks a redraw. */
    public setTabsVisible(visible: boolean): void {
        this.tabs.hidden = !visible;
        this.sash.hidden = !visible;
    }

    public get isTabsVisible(): boolean {
        return !this.tabs.hidden;
    }

    public setLocation(location: TerminalTabsLocation): void {
        this.tabsOnLeft = location === "left";
        this.markDirty();
    }

    public setTabsWidth(width: number): void {
        this.tabsWidth = width;
        this.markDirty();
    }

    /** The width the list is laid out with now. */
    public get tabsColumns(): number {
        return terminalTabsColumns(this.tabsWidth, this.layoutSize.width);
    }

    /** `workbench.sash.hoverDelay`. */
    public setSashHoverDelay(ms: number): void {
        this.sash.hoverDelay = ms;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const tabsWidth = this.isTabsVisible ? terminalTabsColumns(this.tabsWidth, size.width) : 0;
        const dividerWidth = this.isTabsVisible ? 1 : 0;
        const terminalWidth = size.width - tabsWidth - dividerWidth;
        const tabsX = this.tabsOnLeft ? 0 : terminalWidth + dividerWidth;
        // No need to lay out a hidden list and sash, but no harm either — they aren't drawn.
        this.layoutChild(this.tabs, tabsX, 0, Constraints.tight(new Size(tabsWidth, size.height)));
        const sashX = this.tabsOnLeft ? tabsWidth : terminalWidth;
        this.layoutChild(this.sash, sashX, 0, Constraints.tight(new Size(dividerWidth, size.height)));
        if (this.terminal !== null) {
            const terminalX = this.tabsOnLeft ? tabsWidth + dividerWidth : 0;
            this.layoutChild(this.terminal, terminalX, 0, Constraints.tight(new Size(terminalWidth, size.height)));
        }
        return size;
    }
}
