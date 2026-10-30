import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { IPaneMenuAnchor } from "./paneHeaderElement.ts";
import { PaneHeaderElement } from "./paneHeaderElement.ts";
import type { IViewTitleAction } from "./viewTitleRowElement.ts";

/** A section body shorter than this is useless; clamps both drag and height distribution. */
const DEFAULT_MIN_BODY_HEIGHT = 3;

/**
 * Upstream `minimumBodySize`/`maximumBodySize` of a low-priority section sized by its content (Open
 * Editors): see {@link IPaneOptions.contentBounds}.
 */
export interface IPaneContentBounds {
    readonly min: number;
    readonly max: number;
}

export interface IPaneOptions {
    /** Unique within the container; dots become dashes in the header id because inspector/e2e selectors don't support them. */
    readonly id: string;
    readonly title: string;
    /** Dimmed next to the title (upstream `TreeView.description`). */
    readonly description?: string | null;
    readonly body: TUIElement;
    readonly minBodyHeight?: number;
    /**
     * A section sized by its content (upstream `LayoutPriority.Low` with body size bounds): it takes its
     * weight in rows clamped to the bounds — so `min` until the user drags it — and the other sections
     * share what is left. Replaces {@link minBodyHeight}.
     */
    readonly contentBounds?: IPaneContentBounds | null;
    /** `false` for a merged section: no chevron, click/Enter on the header does nothing. Defaults to `true`. */
    readonly collapsible?: boolean;
    /**
     * `false` means no header row at all: for the only section of a panel tab, the tab itself is
     * the header. Defaults to `true`.
     */
    readonly headerVisible?: boolean;
    /** The header title opens the sidebar container switcher ({@link PaneViewElement.onDidRequestSwitcher}). */
    readonly switcher?: boolean;
}

interface PaneRecord {
    readonly id: string;
    readonly header: PaneHeaderElement;
    body: TUIElement;
    readonly minBodyHeight: number;
    contentBounds: IPaneContentBounds | null;
    readonly collapsible: boolean;
    readonly headerVisible: boolean;
    collapsed: boolean;
    /** Share of height among expanded sections; after a drag, the actual row count. */
    weight: number;
    /** Body height from the last layout; the base for converting a drag delta into rows. */
    lastBodyHeight: number;
}

/**
 * Stack of collapsible sections (like upstream PaneView/SplitView). Expanded bodies split the remaining
 * height by weight; a collapsed body stays in the tree with `hidden = true`. The boundary is the header of
 * the lower section: dragging it moves rows between neighbors and freezes the weights to the actual heights.
 */
export class PaneViewElement extends TUIElement {
    /** Fires only on user action, not from performLayout or programmatic setters. */
    public onDidChangeState?: () => void;
    public onDidRequestPaneMenu?: (paneId: string, anchor: IPaneMenuAnchor) => void;
    public onDidRequestPaneAction?: (paneId: string, actionId: string) => void;
    public onDidRequestSwitcher?: (anchor: IPaneMenuAnchor) => void;

    private panes: PaneRecord[] = [];
    private nerdFont = true;

    /** Applies to the headers added later too. */
    public setNerdFont(nerdFont: boolean): void {
        this.nerdFont = nerdFont;
        for (const pane of this.panes) pane.header.setNerdFont(nerdFont);
    }

    public addPane(options: IPaneOptions): void {
        if (this.findPane(options.id) !== undefined) {
            throw new Error(`PaneViewElement: duplicate pane id "${options.id}"`);
        }
        const collapsible = options.collapsible ?? true;
        const headerVisible = options.headerVisible ?? true;
        const header = new PaneHeaderElement(options.title, { collapsible });
        header.hidden = !headerVisible;
        header.setSwitcher(options.switcher ?? false);
        header.setDescription(options.description ?? null);
        header.setNerdFont(this.nerdFont);
        header.id = `paneHeader-${options.id.replaceAll(".", "-")}`;
        const record: PaneRecord = {
            id: options.id,
            header,
            body: options.body,
            minBodyHeight: options.minBodyHeight ?? DEFAULT_MIN_BODY_HEIGHT,
            contentBounds: options.contentBounds ?? null,
            collapsible,
            headerVisible,
            collapsed: false,
            weight: 1,
            lastBodyHeight: 0,
        };
        header.onToggle = () => {
            this.toggleCollapsed(record.id);
        };
        header.onDrag = (boundaryScreenY) => {
            this.dragBoundary(record, boundaryScreenY);
        };
        header.onMenu = (anchor) => this.onDidRequestPaneMenu?.(record.id, anchor);
        header.onAction = (actionId) => this.onDidRequestPaneAction?.(record.id, actionId);
        header.onSwitch = (anchor) => this.onDidRequestSwitcher?.(anchor);
        this.panes.push(record);
        this.appendChild(header);
        this.appendChild(options.body);
        this.syncPanes();
        this.markDirty();
    }

    public removePane(id: string): void {
        const pane = this.findPane(id);
        if (pane === undefined) return;
        this.removeChild(pane.header);
        this.removeChild(pane.body);
        this.panes = this.panes.filter((p) => p !== pane);
        this.syncPanes();
        this.markDirty();
    }

    /** Keeps collapsed state, weight and position, which a remove/add rebuild would reset. */
    public setPaneBody(id: string, body: TUIElement): void {
        const pane = this.paneOrThrow(id);
        if (pane.body === body) return;
        this.removeChild(pane.body);
        pane.body = body;
        body.hidden = pane.collapsed;
        this.appendChild(body);
        this.markDirty();
    }

    /** See {@link IPaneOptions.contentBounds}; `null` makes the section share height by weight again. */
    public setPaneContentBounds(id: string, bounds: IPaneContentBounds | null): void {
        this.paneOrThrow(id).contentBounds = bounds;
        this.markDirty();
    }

    public setPaneActions(id: string, actions: readonly IViewTitleAction[]): void {
        this.paneOrThrow(id).header.setActions(actions);
    }

    public setPaneTitleWidget(id: string, widget: TUIElement | null): void {
        this.paneOrThrow(id).header.setTitleWidget(widget);
    }

    public setPaneSpinner(id: string, frame: string | null): void {
        this.paneOrThrow(id).header.setSpinnerFrame(frame);
    }

    public setPaneMenuVisible(id: string, visible: boolean): void {
        this.paneOrThrow(id).header.setMenuVisible(visible);
    }

    public getPaneIds(): readonly string[] {
        return this.panes.map((p) => p.id);
    }

    public isCollapsed(id: string): boolean {
        return this.paneOrThrow(id).collapsed;
    }

    /** Programmatic path (restore from persisted state); does not fire {@link onDidChangeState}. */
    public setCollapsed(id: string, collapsed: boolean): void {
        this.applyCollapsed(this.paneOrThrow(id), collapsed);
    }

    /** User path (click/Enter on the header); fires {@link onDidChangeState}. */
    public toggleCollapsed(id: string): void {
        const pane = this.paneOrThrow(id);
        if (!pane.collapsible) return;
        this.applyCollapsed(pane, !pane.collapsed);
        this.onDidChangeState?.();
    }

    public getWeights(): Readonly<Record<string, number>> {
        return Object.fromEntries(this.panes.map((p) => [p.id, p.weight]));
    }

    /** Restores weights: unknown ids are ignored, missing ones stay as they are. */
    public setWeights(weights: Readonly<Record<string, number>>): void {
        for (const pane of this.panes) {
            const weight = weights[pane.id];
            if (typeof weight === "number" && Number.isFinite(weight) && weight > 0) {
                pane.weight = Math.round(weight);
            }
        }
        this.markDirty();
    }

    public focusPane(id: string): void {
        this.paneOrThrow(id).header.focus();
    }

    private findPane(id: string): PaneRecord | undefined {
        return this.panes.find((p) => p.id === id);
    }

    private paneOrThrow(id: string): PaneRecord {
        const pane = this.findPane(id);
        if (pane === undefined) throw new Error(`PaneViewElement: unknown pane id "${id}"`);
        return pane;
    }

    private applyCollapsed(pane: PaneRecord, collapsed: boolean): void {
        // A non-collapsible section ignores both stale persisted state and the (theoretical)
        // user path; its header doesn't send onToggle anyway.
        if (!pane.collapsible) return;
        if (pane.collapsed === collapsed) return;
        pane.collapsed = collapsed;
        pane.header.setExpanded(!collapsed);
        if (collapsed) this.rescueFocus(pane);
        this.syncPanes();
        this.markDirty();
    }

    /** Moves focus out of a body being hidden onto its section header. */
    private rescueFocus(pane: PaneRecord): void {
        let element = this.getRoot()?.focusManager?.activeElement ?? null;
        while (element !== null) {
            if (element === pane.body) {
                pane.header.focus();
                return;
            }
            element = element.getParent();
        }
    }

    /** Keeps the children's derived flags in sync: hidden for collapsed bodies, whether drag is enabled. */
    private syncPanes(): void {
        for (let i = 0; i < this.panes.length; i++) {
            const pane = this.panes[i];
            pane.body.hidden = pane.collapsed;
            // Dragging a header moves the boundary above it, so it needs an expanded section
            // above (to take rows from) and an expanded one at or below itself.
            const hasExpandedAbove = this.panes.slice(0, i).some((p) => !p.collapsed);
            const hasExpandedBelow = this.panes.slice(i).some((p) => !p.collapsed);
            pane.header.setDragEnabled(hasExpandedAbove && hasExpandedBelow);
        }
    }

    private dragBoundary(pane: PaneRecord, boundaryScreenY: number): void {
        const index = this.panes.indexOf(pane);
        const abovePane = [...this.panes.slice(0, index)].reverse().find((p) => !p.collapsed);
        const belowPane = this.panes.slice(index).find((p) => !p.collapsed);
        if (abovePane === undefined || belowPane === undefined) return;

        const delta = boundaryScreenY - pane.header.globalPosition.y;
        if (delta === 0) return;
        const heightAbove = abovePane.lastBodyHeight;
        const heightBelow = belowPane.lastBodyHeight;
        // The two sections may be too cramped (their sum is below two minimums after
        // clipping); then the boundary doesn't move at all.
        if (heightAbove + heightBelow < minHeightOf(abovePane) + minHeightOf(belowPane)) return;
        const total = heightAbove + heightBelow;
        const newAbove = Math.max(
            minHeightOf(abovePane),
            total - maxHeightOf(belowPane),
            Math.min(heightAbove + delta, total - minHeightOf(belowPane), maxHeightOf(abovePane)),
        );
        const applied = newAbove - heightAbove;
        if (applied === 0) return;

        abovePane.lastBodyHeight = heightAbove + applied;
        belowPane.lastBodyHeight = heightBelow - applied;
        // Freeze the weights to the actual heights: the next layout with the same
        // remaining height reproduces them exactly (largest remainder with no fractions).
        for (const p of this.panes) {
            if (!p.collapsed) p.weight = Math.max(1, p.lastBodyHeight);
        }
        this.markDirty();
        this.onDidChangeState?.();
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const headerRows = this.panes.filter((p) => p.headerVisible).length;
        const avail = Math.max(0, size.height - headerRows);
        const heights = this.computeBodyHeights(avail);

        let y = 0;
        for (let i = 0; i < this.panes.length; i++) {
            const pane = this.panes[i];
            // Headers are always laid out: when height runs short, trailing ones
            // are clipped to zero height (nesting invariant). A section without a
            // header (panel tab) takes no row for it.
            const headerHeight = pane.headerVisible ? Math.max(0, Math.min(1, size.height - y)) : 0;
            this.layoutChild(pane.header, 0, y, BoxConstraints.tight(new Size(size.width, headerHeight)));
            y += headerHeight;
            if (pane.collapsed) {
                pane.lastBodyHeight = 0;
                continue;
            }
            const bodyHeight = Math.max(0, Math.min(heights[i], size.height - y));
            this.layoutChild(pane.body, 0, y, BoxConstraints.tight(new Size(size.width, bodyHeight)));
            pane.lastBodyHeight = bodyHeight;
            y += bodyHeight;
        }
        return size;
    }

    /** Body heights by section index (0 for collapsed ones and those past the available height). */
    private computeBodyHeights(avail: number): number[] {
        const heights = this.panes.map(() => 0);
        const expanded = this.panes.map((pane, index) => ({ pane, index })).filter(({ pane }) => !pane.collapsed);
        if (expanded.length === 0 || avail <= 0) return heights;
        if (expanded.length === 1) {
            heights[expanded[0].index] = avail;
            return heights;
        }
        let remaining = avail;
        // Content-sized sections first: their rows are their own, the others share what is left.
        for (const { pane, index } of expanded) {
            if (pane.contentBounds === null) continue;
            const { min, max } = pane.contentBounds;
            heights[index] = Math.min(Math.max(min, Math.min(max, pane.weight)), remaining);
            remaining -= heights[index];
        }
        const flexible = expanded.filter(({ pane }) => pane.contentBounds === null);
        const shares = distributeByWeight(
            remaining,
            flexible.map(({ pane }) => pane.weight),
        );
        // Clamp to minBodyHeight greedily in section order: the sum of desired ≥ avail,
        // so the remainder runs out and trailing sections may get 0.
        flexible.forEach(({ pane, index }, k) => {
            const desired = Math.max(pane.minBodyHeight, shares[k]);
            const height = Math.min(desired, remaining);
            heights[index] = height;
            remaining -= height;
        });
        return heights;
    }

    public override inspectState(): Record<string, unknown> {
        return {
            panes: this.panes.map((p) => ({
                id: p.id,
                collapsed: p.collapsed,
                weight: p.weight,
                bodyHeight: p.lastBodyHeight,
            })),
        };
    }
}

function minHeightOf(pane: PaneRecord): number {
    return pane.contentBounds?.min ?? pane.minBodyHeight;
}

function maxHeightOf(pane: PaneRecord): number {
    return pane.contentBounds?.max ?? Number.POSITIVE_INFINITY;
}

/**
 * Deterministic largest remainder: leftover rows go by descending fractional part, ties to the
 * earlier section. Weights are always positive.
 */
function distributeByWeight(total: number, weights: readonly number[]): number[] {
    const sum = weights.reduce((a, b) => a + b, 0);
    const base = weights.map((w) => Math.floor((total * w) / sum));
    let remainder = total - base.reduce((a, b) => a + b, 0);
    const order = weights
        .map((w, i) => ({ i, frac: (total * w) / sum - base[i] }))
        .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (const { i } of order) {
        if (remainder <= 0) break;
        base[i] += 1;
        remainder -= 1;
    }
    return base;
}
