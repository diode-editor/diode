import { packRgb } from "../../common/colorUtils.ts";
import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import { StyleFlags } from "../../common/styleFlags.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

/** A view hosted in the bottom Panel (e.g. Problems, Output). */
export interface PanelView {
    readonly id: string;
    readonly title: string;
    /** The view's content element; null renders {@link placeholder} instead. */
    content: TUIElement | null;
    /**
     * View-specific controls pinned to the right of the tab row (VS Code's
     * `MenuId.ViewTitle` area) — e.g. the Output channel selector.
     */
    actions?: TUIElement | null;
    /** Empty-state message shown when `content` is null (à la VS Code view welcome). */
    readonly placeholder?: string;
}

interface TabSegment {
    readonly id: string;
    readonly start: number;
    readonly end: number;
}

export interface IPanelContainerStyles {
    readonly background: number;
    readonly titleForeground: number;
    readonly borderColor: number;
}

// Defaults preserve the historical look; the controller overrides them via setStyles.
export const unthemedPanelContainerStyles: IPanelContainerStyles = {
    background: packRgb(24, 24, 24),
    titleForeground: packRgb(142, 142, 142),
    borderColor: packRgb(43, 43, 43),
};

/** One space of padding on each side of a tab title. */
const TAB_PAD = 1;
/** Indent of the tab strip from the left edge. */
const TAB_INDENT = 1;
/** Row the tab header sits on (below the top border strip). */
const TAB_ROW = 1;
/** First content row (below the top border strip + tab header). */
const CONTENT_TOP = 2;
/** Left indent of the content area / placeholder (aligns under the tab label). */
const CONTENT_LEFT = 2;

/**
 * The bottom **Panel** part (VS Code `ViewContainerLocation.Panel`): a top border
 * strip + a header row of view tabs (PROBLEMS, OUTPUT, …), a left border that
 * separates it from the sidebar, and the active view's content below. Views are
 * registered via {@link addView}; the active one is shown. A view with no content
 * element renders its {@link PanelView.placeholder} empty-state message.
 *
 * Tab labels are drawn dim (`panelTitle.inactiveForeground`); the active tab is
 * marked with an underline. Colours are pushed by the controller (`panel.*` /
 * `panelTitle.*`), mirroring how `EditorElement` receives its theme colours.
 */
export class PanelContainerElement extends TUIElement {
    private styles: IPanelContainerStyles = unthemedPanelContainerStyles;

    public setStyles(styles: IPanelContainerStyles): void {
        this.styles = styles;
        this.markDirty();
    }

    /** Fired when a tab is clicked (after the active view has switched). */
    public onActivateView?: (id: string) => void;

    private views: PanelView[] = [];
    private activeId: string | null = null;

    public constructor() {
        super();
        this.addEventListener("mousedown", (event) => {
            if (event.button !== "left") return;
            // Событие, всплывшее из дочернего контрола (селектор в шапке), не наше:
            // без этой проверки клик по нему ещё и переключал бы вкладку.
            if (event.target !== this) return;
            const localY = event.screenY - this.globalPosition.y;
            if (localY !== TAB_ROW) return; // only the tab header row switches tabs
            const localX = event.screenX - this.globalPosition.x;
            const segment = this.tabSegments().find((s) => localX >= s.start && localX < s.end);
            if (segment === undefined) return;
            this.setActiveView(segment.id);
            this.onActivateView?.(segment.id);
        });
    }

    public addView(view: PanelView): void {
        this.views.push(view);
        this.activeId ??= view.id;
        this.syncChildren();
        this.markDirty();
    }

    /** Replaces a registered view's title-row controls (null removes them). */
    public setViewActions(id: string, actions: TUIElement | null): void {
        const view = this.views.find((v) => v.id === id);
        if (view === undefined) return;
        view.actions = actions;
        this.syncChildren();
        this.markDirty();
    }

    /** Replaces a registered view's content element (e.g. swapping a placeholder for the real view). */
    public setViewContent(id: string, content: TUIElement | null): void {
        const view = this.views.find((v) => v.id === id);
        if (view === undefined) return;
        view.content = content;
        this.syncChildren();
        this.markDirty();
    }

    public setActiveView(id: string): void {
        if (this.views.every((v) => v.id !== id) || this.activeId === id) return;
        this.activeId = id;
        this.syncChildren();
        this.markDirty();
    }

    /**
     * Все вкладки живут в дереве постоянно; неактивные — hidden (root и стили
     * доходят до них всегда). Раньше getChildren() отдавал только активную, и
     * контент/actions, прицепленные до укоренения панели, оставались с
     * протухшим root — модель бага #204 (селектор каналов Output молча не
     * открывал выпадашку после restore сессии).
     */
    private syncChildren(): void {
        const children: TUIElement[] = [];
        for (const view of this.views) {
            const isActive = view.id === this.activeId;
            if (view.actions != null) {
                view.actions.hidden = !isActive;
                children.push(view.actions);
            }
            if (view.content !== null) {
                view.content.hidden = !isActive;
                children.push(view.content);
            }
        }
        this.setChildren(children);
    }

    public getActiveViewId(): string | null {
        return this.activeId;
    }

    public getViewIds(): string[] {
        return this.views.map((v) => v.id);
    }

    /**
     * Observable panel state for the inspector: which tabs exist, which is
     * active, and each tab's absolute hit geometry. Replaces the e2e helper that
     * re-derived tab coordinates from TAB_INDENT/TAB_PAD by hand — a test clicks
     * `tabs[i].centerX` on `tabRow` instead.
     */
    public override inspectState(): Record<string, unknown> {
        const originX = this.globalPosition.x;
        let x = TAB_INDENT;
        const tabs = this.views.map((view) => {
            const width = view.title.length + TAB_PAD * 2;
            const start = x;
            x += width;
            return {
                id: view.id,
                title: view.title,
                active: view.id === this.activeId,
                x: originX + start,
                width,
                centerX: originX + start + Math.floor(width / 2),
            };
        });
        return { activeId: this.activeId, tabRow: this.globalPosition.y + TAB_ROW, tabs };
    }

    /** Правая граница таб-строки — за неё контролы вкладки заезжать не должны. */
    private tabsEnd(): number {
        return this.views.reduce((x, view) => x + view.title.length + TAB_PAD * 2, TAB_INDENT);
    }

    private activeView(): PanelView | undefined {
        return this.views.find((v) => v.id === this.activeId);
    }

    /** Header tab layout: ` Title ` segments after the indent, with hit ranges. */
    private tabSegments(): TabSegment[] {
        const segments: TabSegment[] = [];
        let x = TAB_INDENT;
        for (const view of this.views) {
            const width = view.title.length + TAB_PAD * 2;
            segments.push({ id: view.id, start: x, end: x + width });
            x += width;
        }
        return segments;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const containerSize = super.performLayout(constraints);
        // Контролы вкладки прижаты вправо на строке табов — как в шапке Panel у
        // VS Code. Ширину берём интринсиковую и не даём заехать на сами табы.
        const actions = this.activeView()?.actions;
        if (actions != null) {
            const actionsWidth = Math.min(actions.getMaxIntrinsicWidth(1), containerSize.width);
            const x = Math.max(this.tabsEnd(), containerSize.width - actionsWidth - TAB_INDENT);
            this.layoutChild(actions, x, TAB_ROW, BoxConstraints.tight(new Size(Math.max(0, containerSize.width - x), 1)));
        }
        const content = this.activeView()?.content;
        if (content != null) {
            const contentWidth = Math.max(0, containerSize.width - CONTENT_LEFT);
            const contentHeight = Math.max(0, containerSize.height - CONTENT_TOP);
            this.layoutChild(content, CONTENT_LEFT, CONTENT_TOP, BoxConstraints.tight(new Size(contentWidth, contentHeight)));
        }
        return containerSize;
    }

    public override render(context: RenderContext): void {
        const { width, height } = this.layoutSize;

        // Fill the panel with its background first.
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                context.setCell(x, y, { char: " ", bg: this.styles.background });
            }
        }

        // Top border strip (row 0).
        for (let x = 0; x < width; x++) {
            context.setCell(x, 0, { char: "─", fg: this.styles.borderColor, bg: this.styles.background });
        }

        // Tab header (dim). The active tab is underlined — but only under the title
        // glyphs, leaving the surrounding padding un-underlined.
        const segments = this.tabSegments();
        for (let i = 0; i < this.views.length; i++) {
            const view = this.views[i];
            const segment = segments[i];
            const isActive = view.id === this.activeId;
            for (let x = segment.start; x < segment.end && x < width; x++) {
                const textIndex = x - segment.start - TAB_PAD;
                const isGlyph = textIndex >= 0 && textIndex < view.title.length;
                const char = isGlyph ? view.title[textIndex] : " ";
                const style = isActive && isGlyph ? StyleFlags.Underline : StyleFlags.None;
                context.setCell(x, TAB_ROW, {
                    char,
                    fg: this.styles.titleForeground,
                    bg: this.styles.background,
                    style,
                });
            }
        }

        // View-specific controls in the title row (drawn after the tabs so they win
        // the shared row), then the active view's content below — renderChildren
        // рисует только видимых детей, скрытые вкладки пропускаются базой.
        this.renderChildren(context);

        // Placeholder empty-state message, если у активной вкладки нет контента.
        const active = this.activeView();
        if (active?.content == null && active?.placeholder !== undefined && height > CONTENT_TOP) {
            const message = active.placeholder;
            for (let i = 0; i < message.length && i + CONTENT_LEFT < width; i++) {
                context.setCell(i + CONTENT_LEFT, CONTENT_TOP, {
                    char: message[i],
                    fg: this.styles.titleForeground,
                    bg: this.styles.background,
                });
            }
        }
    }
}
