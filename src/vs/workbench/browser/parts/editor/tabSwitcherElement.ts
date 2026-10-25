import { DisplayLine } from "@tuidom/core/common/displayLine";
import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { truncateEnd } from "@tuidom/core/common/textTruncation";
import { BORDER_THICKNESS } from "@tuidom/core/dom/borderStyle";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { HFlexElement, hflexFill, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { VFlexElement, vflexFixed } from "@tuidom/elements/layout/vFlexElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { CONTENT_PAD, QuickPickFrameElement } from "../quickinput/quickPickFrameElement.ts";

/** The glyph plus a trailing space (like the quick pick). */
const ICON_WIDTH = 2;
const MODIFIED_MARKER = " ●";

export interface TabSwitcherItem {
    /** `undefined`: no file icons (`diode.icons.nerdFont: off`), the column and its gap disappear. */
    readonly icon?: string;
    /** Packed RGB, as in the tab strip. */
    readonly iconColor?: number;
    readonly label: string;
    readonly isModified: boolean;
}

/**
 * Purely presentational: takes no input and no focus; the MRU cycle commands drive it.
 * A long list does not scroll but shows a sliding window around the cycle position, with no
 * virtualization: there are ten rows at most.
 */
export class TabSwitcherElement extends TUIElement {
    /** Clamped by the constraints. */
    public preferredWidth = 48;
    public maxVisibleItems = 10;

    private readonly frame: QuickPickFrameElement;
    private readonly body: VFlexElement;

    private itemsValue: readonly TabSwitcherItem[] = [];
    private currentIndexValue = 0;
    private windowStart = 0;

    public constructor() {
        super();
        this.style = { fg: "quickInput.foreground", bg: "quickInput.background" };
        this.body = new VFlexElement();
        this.frame = new QuickPickFrameElement(this.body);
        this.appendChild(this.frame);
    }

    /** Moves the sliding window so the cycle position stays visible. */
    public setItems(items: readonly TabSwitcherItem[], currentIndex: number): void {
        this.itemsValue = items;
        this.currentIndexValue = Math.max(0, Math.min(items.length - 1, currentIndex));
        this.slideWindow();
        this.rebuildRows();
    }

    public override inspectState(): Record<string, unknown> {
        return {
            items: this.itemsValue.map((item) => item.label),
            currentIndex: this.currentIndexValue,
            windowStart: this.windowStart,
        };
    }

    public get totalHeight(): number {
        return Math.min(this.itemsValue.length, this.maxVisibleItems) + BORDER_THICKNESS * 2;
    }

    /** When the cycle wraps around, the window jumps back to the matching edge. */
    private slideWindow(): void {
        const lastStart = Math.max(0, this.itemsValue.length - this.maxVisibleItems);
        // Stryker disable next-line EqualityOperator: at the boundary (current == windowStart) the assignment writes the same value, so the `<=` mutant is indistinguishable
        if (this.currentIndexValue < this.windowStart) this.windowStart = this.currentIndexValue;
        // Stryker disable next-line EqualityOperator: at the boundary (current == bottom edge of the window) the assignment below computes the same windowStart, so the `>=` mutant is indistinguishable
        if (this.currentIndexValue > this.windowStart + this.maxVisibleItems - 1) {
            this.windowStart = this.currentIndexValue - this.maxVisibleItems + 1;
        }
        this.windowStart = Math.max(0, Math.min(lastStart, this.windowStart));
    }

    private rebuildRows(): void {
        const innerWidth = Math.max(0, this.preferredWidth - BORDER_THICKNESS * 2);
        const rows: TUIElement[] = [];
        const end = Math.min(this.itemsValue.length, this.windowStart + this.maxVisibleItems);
        for (let index = this.windowStart; index < end; index++) {
            const row = this.buildRow(this.itemsValue[index], index === this.currentIndexValue, innerWidth);
            row.layoutStyle = { height: vflexFixed(1), width: "fill" };
            rows.push(row);
        }
        this.body.replaceChildren(rows);
    }

    /** The icon keeps its token color even on the highlighted row (as in the tab strip). */
    private buildRow(item: TabSwitcherItem, isCurrent: boolean, innerWidth: number): HFlexElement {
        const row = new HFlexElement();
        if (isCurrent) {
            row.style = { fg: "list.activeSelectionForeground", bg: "list.activeSelectionBackground" };
        }

        row.addChild(new FillerElement(), { width: hflexFixed(CONTENT_PAD), height: 1 });

        const iconWidth = item.icon === undefined ? 0 : ICON_WIDTH;
        if (item.icon !== undefined) {
            const icon = new TextLabelElement(item.icon);
            icon.style = { fg: item.iconColor };
            row.addChild(icon, { width: hflexFixed(ICON_WIDTH), height: 1 });
        }

        const marker = item.isModified ? MODIFIED_MARKER : null;
        const markerWidth = marker === null ? 0 : new DisplayLine(marker).displayWidth;
        const budget = Math.max(0, innerWidth - CONTENT_PAD * 2 - iconWidth - markerWidth);
        const label = new TextLabelElement(truncateEnd(item.label, budget));
        row.addChild(label, { width: hflexFixed(new DisplayLine(label.getText()).displayWidth), height: 1 });

        row.addChild(new FillerElement(), { width: hflexFill(), height: 1 });

        if (marker !== null) {
            row.addChild(new TextLabelElement(marker), { width: hflexFixed(markerWidth), height: 1 });
        }

        row.addChild(new FillerElement(), { width: hflexFixed(CONTENT_PAD), height: 1 });
        return row;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const natural = new Size(this.preferredWidth, this.totalHeight);
        const size = constraints.constrain(natural);
        super.performLayout(BoxConstraints.tight(size));
        this.layoutChild(this.frame, 0, 0, BoxConstraints.tight(size));
        return size;
    }
}
