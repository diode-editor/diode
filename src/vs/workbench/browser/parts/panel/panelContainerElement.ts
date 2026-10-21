import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { TUIContextMenuEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";
import { wrapText } from "@tuidom/elements/completionlist/completionDetailsElement";

export interface PanelView {
    readonly id: string;
    readonly title: string;
    content: TUIElement | null;
    /** VS Code `MenuId.ViewTitle` area. */
    actions?: TUIElement | null;
    readonly placeholder?: string;
}

interface TabSegment {
    readonly id: string;
    readonly start: number;
    readonly end: number;
}

const TAB_PAD = 1;
const TAB_INDENT = 1;
/**
 * Defaults match the bottom panel; the auxiliary bar (upstream the same
 * `AbstractPaneCompositePart`) is drawn like the sidebar.
 */
export interface IPanelContainerOptions {
    readonly background?: string;
    readonly foreground?: string;
    readonly topBorder?: boolean;
    readonly contentLeft?: number;
    /** Upstream: "Drag a view here to display." in `paneCompositePart.ts`. */
    readonly emptyMessage?: string;
}

/**
 * Not a codicon: private use area glyphs are invisible in a text dump of the
 * frame, so a scenario could not check it.
 */
const CLOSE_LABEL = " × ";
const CLOSE_WIDTH = CLOSE_LABEL.length;

/** VS Code `ViewContainerLocation.Panel`. */
export class PanelContainerElement extends TUIElement {
    public onActivateView?: (id: string) => void;
    public onClose?: () => void;
    /** Right click or Shift+F10; the anchor is the popup's screen point. */
    public onTabContextMenu?: (id: string, anchor: { readonly screenX: number; readonly screenY: number }) => void;

    private views: PanelView[] = [];
    private activeId: string | null = null;
    private closeHovered = false;

    private readonly tabRow: number;
    private readonly contentTop: number;
    private readonly contentLeft: number;
    private readonly topBorder: boolean;
    private readonly emptyMessage: string | undefined;

    public constructor(options: IPanelContainerOptions = {}) {
        super();
        this.topBorder = options.topBorder ?? true;
        this.tabRow = this.topBorder ? 1 : 0;
        this.contentTop = this.tabRow + 1;
        this.contentLeft = options.contentLeft ?? 2;
        this.emptyMessage = options.emptyMessage;
        this.style = { fg: options.foreground, bg: options.background ?? "panel.background" };
        this.addEventListener("mousedown", (event) => {
            if (event.button !== "left") return;
            // An event from a child control (the header selector) is not ours: otherwise clicking it would switch tabs.
            if (event.target !== this) return;
            const localY = event.screenY - this.globalPosition.y;
            if (localY !== this.tabRow) return;
            const localX = event.screenX - this.globalPosition.x;
            // Close button before tabs: on a narrow panel it is drawn ON TOP of the
            // tab row tail and must win there.
            if (this.isCloseHit(localX)) {
                this.onClose?.();
                return;
            }
            const segment = this.tabSegments().find((s) => localX >= s.start && localX < s.end);
            if (segment === undefined) return;
            this.setActiveView(segment.id);
            this.onActivateView?.(segment.id);
        });
        // No source check as in mousedown: no child overlaps the button columns.
        this.addEventListener("mousemove", (event) => {
            const localY = event.screenY - this.globalPosition.y;
            const localX = event.screenX - this.globalPosition.x;
            this.setCloseHovered(localY === this.tabRow && this.isCloseHit(localX));
        });
        this.addEventListener("mouseleave", () => {
            this.setCloseHovered(false);
        });
        // Upstream: the composite bar menu ("Move To", "Reset Location").
        this.addEventListener("contextmenu", (event) => {
            if (event.target !== this) return;
            const menuEvent = event as TUIContextMenuEvent;
            const segments = this.tabSegments();
            const originX = this.globalPosition.x;
            const tabRow = this.globalPosition.y + this.tabRow;
            const segment =
                menuEvent.trigger === "keyboard"
                    ? segments.find((s) => s.id === this.activeId)
                    : menuEvent.screenY === tabRow
                      ? segments.find(
                            (s) => menuEvent.screenX - originX >= s.start && menuEvent.screenX - originX < s.end,
                        )
                      : undefined;
            if (segment === undefined) return;
            event.preventDefault();
            const anchor =
                menuEvent.trigger === "keyboard"
                    ? { screenX: originX + segment.start, screenY: tabRow + 1 }
                    : { screenX: menuEvent.screenX, screenY: menuEvent.screenY };
            this.onTabContextMenu?.(segment.id, anchor);
        });
    }

    public addView(view: PanelView, index = this.views.length): void {
        this.views.splice(index, 0, view);
        this.activeId ??= view.id;
        this.syncChildren();
    }

    /** Removing the active one activates the first remaining one. */
    public removeView(id: string): void {
        const index = this.views.findIndex((v) => v.id === id);
        if (index < 0) return;
        this.views.splice(index, 1);
        if (this.activeId === id) this.activeId = this.views.at(0)?.id ?? null;
        this.syncChildren();
    }

    public setViewActions(id: string, actions: TUIElement | null): void {
        const view = this.views.find((v) => v.id === id);
        if (view === undefined) return;
        view.actions = actions;
        this.syncChildren();
    }

    public setViewContent(id: string, content: TUIElement | null): void {
        const view = this.views.find((v) => v.id === id);
        if (view === undefined) return;
        view.content = content;
        this.syncChildren();
    }

    public setActiveView(id: string): void {
        if (this.views.every((v) => v.id !== id) || this.activeId === id) return;
        this.activeId = id;
        this.syncChildren();
    }

    /**
     * All tabs stay in the tree, inactive ones hidden: otherwise content attached
     * before the panel was rooted kept a stale root (#204).
     * `setChildren` calls `markDirty` itself, so setters need no call of their own.
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

    /** Absolute hit-box geometry: a test clicks `tabs[i].centerX` / `close.centerX`. */
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
        const closeStart = this.closeStart();
        const close =
            closeStart === null
                ? null
                : {
                      x: originX + closeStart,
                      width: CLOSE_WIDTH,
                      centerX: originX + closeStart + Math.floor(CLOSE_WIDTH / 2),
                  };
        return { activeId: this.activeId, tabRow: this.globalPosition.y + this.tabRow, tabs, close };
    }

    private tabsEnd(): number {
        return this.views.reduce((x, view) => x + view.title.length + TAB_PAD * 2, TAB_INDENT);
    }

    /** `null` when the panel is narrower than the button itself. */
    private closeStart(): number | null {
        const width = this.layoutSize.width;
        return width < CLOSE_WIDTH ? null : width - CLOSE_WIDTH;
    }

    private isCloseHit(localX: number): boolean {
        const start = this.closeStart();
        return start !== null && localX >= start && localX < start + CLOSE_WIDTH;
    }

    private setCloseHovered(hovered: boolean): void {
        if (this.closeHovered === hovered) return;
        this.closeHovered = hovered;
        this.markDirty();
    }

    private activeView(): PanelView | undefined {
        return this.views.find((v) => v.id === this.activeId);
    }

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
        // Use the intrinsic width and keep it off both the tabs and the close
        // button: the button's leading space serves as the gap.
        const actions = this.activeView()?.actions;
        if (actions != null) {
            const available = Math.max(0, containerSize.width - CLOSE_WIDTH);
            const actionsWidth = Math.min(actions.getMaxIntrinsicWidth(1), available);
            const x = Math.max(this.tabsEnd(), available - actionsWidth);
            this.layoutChild(actions, x, this.tabRow, BoxConstraints.tight(new Size(Math.max(0, available - x), 1)));
        }
        const content = this.activeView()?.content;
        if (content != null) {
            const contentWidth = Math.max(0, containerSize.width - this.contentLeft);
            const contentHeight = Math.max(0, containerSize.height - this.contentTop);
            this.layoutChild(
                content,
                this.contentLeft,
                this.contentTop,
                BoxConstraints.tight(new Size(contentWidth, contentHeight)),
            );
        }
        return containerSize;
    }

    public override render(context: RenderContext): void {
        const { width, height } = this.layoutSize;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                context.setCell(x, y, { char: " ", bg: this.resolvedStyle.bg });
            }
        }

        if (this.topBorder) {
            for (let x = 0; x < width; x++) {
                context.setCell(x, 0, { char: "─", fg: this.styleVar("panel.border"), bg: this.resolvedStyle.bg });
            }
        }

        // The active tab is underlined only under the title glyphs, not the padding.
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
                context.setCell(x, this.tabRow, {
                    char,
                    fg: this.styleVar("panelTitle.inactiveForeground"),
                    bg: this.resolvedStyle.bg,
                    style,
                });
            }
        }

        // Controls are drawn after the tabs so they win the shared row.
        this.renderChildren(context);

        // Close button last: on a narrow panel it overlaps the tail of tabs and controls.
        this.renderCloseButton(context);

        const active = this.activeView();
        if (active?.content == null && active?.placeholder !== undefined && height > this.contentTop) {
            const message = active.placeholder;
            // Stryker disable next-line UpdateOperator: "i--" loops rendering forever — the test hangs (verifier timeout) rather than passing; the placeholder text is covered by render tests
            for (let i = 0; i < message.length && i + this.contentLeft < width; i++) {
                context.setCell(i + this.contentLeft, this.contentTop, {
                    char: message[i],
                    fg: this.styleVar("panelTitle.inactiveForeground"),
                    bg: this.resolvedStyle.bg,
                });
            }
        }

        // Word-wrapped: the auxiliary bar is narrow.
        if (this.views.length === 0 && this.emptyMessage !== undefined) {
            const lines = wrapText(this.emptyMessage, Math.max(1, width - this.contentLeft));
            for (let row = 0; row < lines.length && this.contentTop + row < height; row++) {
                const line = lines[row];
                for (let i = 0; i < line.length; i++) {
                    context.setCell(i + this.contentLeft, this.contentTop + row, {
                        char: line[i],
                        fg: this.styleVar("descriptionForeground"),
                        bg: this.resolvedStyle.bg,
                    });
                }
            }
        }
    }

    private renderCloseButton(context: RenderContext): void {
        const start = this.closeStart();
        if (start === null) return;
        const bg = this.closeHovered ? this.styleVar("toolbar.hoverBackground") : this.resolvedStyle.bg;
        for (let i = 0; i < CLOSE_WIDTH; i++) {
            context.setCell(start + i, this.tabRow, {
                char: CLOSE_LABEL[i],
                fg: this.styleVar("descriptionForeground"),
                bg,
            });
        }
    }
}
