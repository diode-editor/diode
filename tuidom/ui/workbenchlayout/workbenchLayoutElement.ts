import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";
import { SashElement } from "../sash/sashElement.ts";

/** Default/reset width of the left panel (file explorer), in columns. */
const DEFAULT_LEFT_WIDTH = 30;
/** Minimum left-panel width — fits the "  EXPLORER" title without clipping. */
const MIN_LEFT_WIDTH = 12;
/** Minimum width left for the center (editor) so a wide sidebar can't starve it. */
const MIN_CENTER_WIDTH = 20;

/** Default/reset height of the bottom panel (Problems, Output, …), in rows. */
const DEFAULT_PANEL_HEIGHT = 12;
/** Minimum bottom-panel height — fits the tab header + a couple of content rows. */
const MIN_PANEL_HEIGHT = 3;
/** Minimum height left for the editor so a tall panel can't starve it. */
const MIN_EDITOR_HEIGHT = 3;

/**
 * Workbench layout: a full-height left panel (sidebar), the center content
 * (editor), and — aligned to the center's width, à la VS Code's default
 * `center` panel alignment — a bottom panel (Problems/Output/…) below the
 * editor. A vertical sash resizes the sidebar; a horizontal sash resizes the
 * bottom panel. The bottom panel is hidden by default (like VS Code).
 */
export class WorkbenchLayoutElement extends TUIElement {
    private leftPanel: TUIElement | null = null;
    private centerContent: TUIElement | null = null;
    private bottomPanel: TUIElement | null = null;

    private leftPanelVisible = true;
    private leftPanelWidth = DEFAULT_LEFT_WIDTH;

    private bottomPanelVisible = false;
    private bottomPanelHeight = DEFAULT_PANEL_HEIGHT;

    /**
     * Уведомление о смене layout по действию пользователя (drag сэша или команда):
     * ширина/высота/видимость панелей. Плейн-колбэк (без DI) — TUIDom не знает про
     * сервисы; подписчик (`LayoutService` через `attachLayout`)
     * персистит состояние. НЕ вызывается из `performLayout` (display-клампы — не
     * действие пользователя).
     */
    public onDidChangeLayout?: () => void;

    // Draggable dividers: vertical between sidebar and editor, horizontal between
    // editor and bottom panel.
    private sash = new SashElement("vertical");
    private bottomSash = new SashElement("horizontal");

    public constructor() {
        super();
        this.syncChildren();
        this.sash.onDrag = (boundaryScreenX) => {
            // Translate the absolute boundary column to a panel width and clamp it.
            this.leftPanelWidth = this.clampWidth(boundaryScreenX - this.globalPosition.x);
            this.markDirty();
            this.onDidChangeLayout?.();
        };
        this.bottomSash.onDrag = (boundaryScreenY) => {
            // The panel's bottom is pinned to the container bottom; the boundary row
            // is its top, so the height is (containerBottom - boundaryRow).
            const containerBottom = this.globalPosition.y + this.layoutSize.height;
            this.bottomPanelHeight = this.clampHeight(containerBottom - boundaryScreenY);
            this.markDirty();
            this.onDidChangeLayout?.();
        };
    }

    /** Color of both sashes' hover line; pass undefined to keep them invisible. */
    public setSashHoverColor(color: number | undefined): void {
        this.sash.hoverBorderColor = color;
        this.bottomSash.hoverBorderColor = color;
    }

    public setLeftPanel(element: TUIElement | null): void {
        this.leftPanel = element;
        this.syncChildren();
    }

    public setCenterContent(element: TUIElement | null): void {
        this.centerContent = element;
        this.syncChildren();
    }

    public setBottomPanel(element: TUIElement | null): void {
        this.bottomPanel = element;
        this.syncChildren();
    }

    public setLeftPanelVisible(visible: boolean): void {
        this.leftPanelVisible = visible;
        this.syncChildren();
        this.onDidChangeLayout?.();
    }

    public getLeftPanelVisible(): boolean {
        return this.leftPanelVisible;
    }

    public setBottomPanelVisible(visible: boolean): void {
        this.bottomPanelVisible = visible;
        this.syncChildren();
        this.onDidChangeLayout?.();
    }

    public getBottomPanelVisible(): boolean {
        return this.bottomPanelVisible;
    }

    public setLeftPanelWidth(width: number): void {
        // Context-free lower clamp; the upper bound depends on the container and is
        // enforced in performLayout (and by clampWidth for interactive changes).
        this.leftPanelWidth = Math.max(MIN_LEFT_WIDTH, Math.round(width));
        this.onDidChangeLayout?.();
    }

    public getLeftPanelWidth(): number {
        return this.leftPanelWidth;
    }

    public setBottomPanelHeight(height: number): void {
        this.bottomPanelHeight = Math.max(MIN_PANEL_HEIGHT, Math.round(height));
        this.onDidChangeLayout?.();
    }

    public getBottomPanelHeight(): number {
        return this.bottomPanelHeight;
    }

    /** Grow/shrink the left panel by `delta` columns, clamped to the current container. */
    public nudgeLeftPanelWidth(delta: number): void {
        this.leftPanelWidth = this.clampWidth(this.leftPanelWidth + delta);
        this.markDirty();
        this.onDidChangeLayout?.();
    }

    /** Restore the left panel to its default width. */
    public resetLeftPanelWidth(): void {
        this.leftPanelWidth = DEFAULT_LEFT_WIDTH;
        this.markDirty();
        this.onDidChangeLayout?.();
    }

    public getLeftPanel(): TUIElement | null {
        return this.leftPanel;
    }

    public getCenterContent(): TUIElement | null {
        return this.centerContent;
    }

    public getBottomPanel(): TUIElement | null {
        return this.bottomPanel;
    }

    /**
     * Пересобирает список детей и их видимость. Скрытая панель ОСТАЁТСЯ в
     * дереве с hidden=true (root и стили доходят — раньше её исключали из
     * getChildren() и руками чинили пропагацию при показе). Sashes are added
     * last so they sit on top of the neighbouring content at the boundary for
     * hit-testing; каждый скрыт вместе со своей панелью.
     */
    private syncChildren(): void {
        const showLeft = this.leftPanel !== null && this.leftPanelVisible;
        const showBottom = this.bottomPanel !== null && this.bottomPanelVisible;
        const children: TUIElement[] = [];
        if (this.leftPanel !== null) {
            this.leftPanel.hidden = !this.leftPanelVisible;
            children.push(this.leftPanel);
        }
        if (this.centerContent !== null) {
            children.push(this.centerContent);
        }
        if (this.bottomPanel !== null) {
            this.bottomPanel.hidden = !this.bottomPanelVisible;
            children.push(this.bottomPanel);
        }
        this.sash.hidden = !showLeft;
        children.push(this.sash);
        this.bottomSash.hidden = !showBottom;
        children.push(this.bottomSash);
        this.setChildren(children);
    }

    private clampWidth(width: number): number {
        return this.clampWidthTo(width, this.layoutSize.width);
    }

    private clampWidthTo(width: number, containerWidth: number): number {
        const maxLeft = Math.max(MIN_LEFT_WIDTH, containerWidth - MIN_CENTER_WIDTH);
        const clamped = Math.max(MIN_LEFT_WIDTH, Math.min(Math.round(width), maxLeft));
        // Never exceed the container itself (degenerate, very narrow terminals).
        return Math.min(clamped, containerWidth);
    }

    private clampHeight(height: number): number {
        return this.clampHeightTo(height, this.layoutSize.height);
    }

    private clampHeightTo(height: number, containerHeight: number): number {
        const maxPanel = Math.max(MIN_PANEL_HEIGHT, containerHeight - MIN_EDITOR_HEIGHT);
        const clamped = Math.max(MIN_PANEL_HEIGHT, Math.min(Math.round(height), maxPanel));
        return Math.min(clamped, containerHeight);
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const containerSize = super.performLayout(constraints);

        const showLeft = this.leftPanel !== null && this.leftPanelVisible;
        const showBottom = this.bottomPanel !== null && this.bottomPanelVisible;
        // Display-only clamps — do NOT mutate the stored width/height, so absolute
        // sizes survive terminal resizes (a temporary shrink is not permanent).
        const leftWidth = showLeft ? this.clampWidthTo(this.leftPanelWidth, containerSize.width) : 0;
        const centerWidth = Math.max(0, containerSize.width - leftWidth);
        const panelHeight = showBottom ? this.clampHeightTo(this.bottomPanelHeight, containerSize.height) : 0;
        const centerHeight = Math.max(0, containerSize.height - panelHeight);

        if (showLeft && this.leftPanel) {
            this.layoutChild(this.leftPanel, 0, 0, BoxConstraints.tight(new Size(leftWidth, containerSize.height)));
        }

        if (this.centerContent) {
            this.layoutChild(this.centerContent, leftWidth, 0, BoxConstraints.tight(new Size(centerWidth, centerHeight)));
        }

        if (showBottom && this.bottomPanel) {
            this.layoutChild(this.bottomPanel, leftWidth, centerHeight, BoxConstraints.tight(new Size(centerWidth, panelHeight)));
        }

        if (showLeft) {
            // 1-column hit target sitting on the boundary between the sidebar and center.
            // Must be laid out explicitly, otherwise its lazy layoutSize would report a
            // stale box at (0,0) and break hit-testing.
            this.layoutChild(this.sash, leftWidth, 0, BoxConstraints.tight(new Size(1, containerSize.height)));
        }

        if (showBottom) {
            // 1-row hit target on the boundary between the editor and the bottom panel,
            // spanning the center width at the panel's top row.
            this.layoutChild(this.bottomSash, leftWidth, centerHeight, BoxConstraints.tight(new Size(centerWidth, 1)));
        }

        return containerSize;
    }


}
