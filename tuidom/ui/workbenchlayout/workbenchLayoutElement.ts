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
        this.sash.setParent(this);
        this.sash.onDrag = (boundaryScreenX) => {
            // Translate the absolute boundary column to a panel width and clamp it.
            this.leftPanelWidth = this.clampWidth(boundaryScreenX - this.globalPosition.x);
            this.markDirty();
            this.onDidChangeLayout?.();
        };
        this.bottomSash.setParent(this);
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
        if (this.leftPanel) {
            this.leftPanel.setParent(null);
        }
        this.leftPanel = element;
        if (element) {
            element.setParent(this);
            // Саш появляется в getChildren() только вместе с панелью: если панель
            // прицепили после укоренения, пропагация root саш уже не увидела —
            // перецепляем явно (нашёл validateTree).
            this.sash.setParent(this);
        }
    }

    public setCenterContent(element: TUIElement | null): void {
        if (this.centerContent) {
            this.centerContent.setParent(null);
        }
        this.centerContent = element;
        if (element) {
            element.setParent(this);
        }
    }

    public setBottomPanel(element: TUIElement | null): void {
        if (this.bottomPanel) {
            this.bottomPanel.setParent(null);
        }
        this.bottomPanel = element;
        if (element) {
            element.setParent(this);
            // См. setLeftPanel: саш делит видимость с панелью.
            this.bottomSash.setParent(this);
        }
    }

    public setLeftPanelVisible(visible: boolean): void {
        const becomingVisible = visible && !this.leftPanelVisible;
        this.leftPanelVisible = visible;
        if (becomingVisible) {
            // Скрытые панель и саш исключены из getChildren() и пропускают
            // пропагацию root/стилей — перецепляем при показе (см. подробный
            // комментарий в setBottomPanelVisible). Нашёл validateTree: раньше
            // перецепляли только панель, а саш оставался с root=null.
            this.leftPanel?.setParent(this);
            this.leftPanel?.markStyleDirty();
            this.sash.setParent(this);
        }
        this.onDidChangeLayout?.();
    }

    public getLeftPanelVisible(): boolean {
        return this.leftPanelVisible;
    }

    public setBottomPanelVisible(visible: boolean): void {
        const becomingVisible = visible && !this.bottomPanelVisible;
        this.bottomPanelVisible = visible;
        if (becomingVisible && this.bottomPanel !== null) {
            // While hidden the panel is excluded from getChildren(), so it misses
            // root/style propagation. Re-attach on show: setParent re-propagates the
            // current root down its subtree, and markStyleDirty forces a fresh style
            // pass (so its content — e.g. the Problems tree — resolves correctly).
            this.bottomPanel.setParent(this);
            this.bottomPanel.markStyleDirty();
            // Саш тоже скрыт вместе с панелью — без перецепления он остаётся
            // с root=null (нашёл validateTree).
            this.bottomSash.setParent(this);
        }
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

    public override getChildren(): readonly TUIElement[] {
        const children: TUIElement[] = [];
        const leftPanel = this.leftPanelVisible ? this.leftPanel : null;
        const bottomPanel = this.bottomPanelVisible ? this.bottomPanel : null;
        if (leftPanel !== null) {
            children.push(leftPanel);
        }
        if (this.centerContent) {
            children.push(this.centerContent);
        }
        if (bottomPanel !== null) {
            children.push(bottomPanel);
        }
        // Sashes are added last so they sit on top of the neighbouring content at the
        // boundary for hit-testing. Each is present only while its panel is shown.
        if (leftPanel !== null) {
            children.push(this.sash);
        }
        if (bottomPanel !== null) {
            children.push(this.bottomSash);
        }
        return children;
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

    public performLayout(constraints: BoxConstraints): Size {
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
            const leftSize = new Size(leftWidth, containerSize.height);
            this.leftPanel.localPosition = new Offset(0, 0);
            this.leftPanel.globalPosition = new Point(this.globalPosition.x, this.globalPosition.y);
            this.leftPanel.performLayout(BoxConstraints.tight(leftSize));
        }

        if (this.centerContent) {
            const centerSize = new Size(centerWidth, centerHeight);
            this.centerContent.localPosition = new Offset(leftWidth, 0);
            this.centerContent.globalPosition = new Point(this.globalPosition.x + leftWidth, this.globalPosition.y);
            this.centerContent.performLayout(BoxConstraints.tight(centerSize));
        }

        if (showBottom && this.bottomPanel) {
            const panelSize = new Size(centerWidth, panelHeight);
            this.bottomPanel.localPosition = new Offset(leftWidth, centerHeight);
            this.bottomPanel.globalPosition = new Point(
                this.globalPosition.x + leftWidth,
                this.globalPosition.y + centerHeight,
            );
            this.bottomPanel.performLayout(BoxConstraints.tight(panelSize));
        }

        if (showLeft) {
            // 1-column hit target sitting on the boundary between the sidebar and center.
            // Must be laid out explicitly, otherwise its lazy layoutSize would report a
            // stale box at (0,0) and break hit-testing.
            this.sash.localPosition = new Offset(leftWidth, 0);
            this.sash.globalPosition = new Point(this.globalPosition.x + leftWidth, this.globalPosition.y);
            this.sash.performLayout(BoxConstraints.tight(new Size(1, containerSize.height)));
        }

        if (showBottom) {
            // 1-row hit target on the boundary between the editor and the bottom panel,
            // spanning the center width at the panel's top row.
            this.bottomSash.localPosition = new Offset(leftWidth, centerHeight);
            this.bottomSash.globalPosition = new Point(
                this.globalPosition.x + leftWidth,
                this.globalPosition.y + centerHeight,
            );
            this.bottomSash.performLayout(BoxConstraints.tight(new Size(centerWidth, 1)));
        }

        return containerSize;
    }

    public render(context: RenderContext): void {
        this.renderChild(context, this.leftPanel, this.leftPanel !== null && this.leftPanelVisible);
        this.renderChild(context, this.centerContent, this.centerContent !== null);
        this.renderChild(context, this.bottomPanel, this.bottomPanel !== null && this.bottomPanelVisible);
        // The sashes sit on top at the boundary; each paints only on hover/drag.
        this.renderChild(context, this.sash, this.leftPanel !== null && this.leftPanelVisible);
        this.renderChild(context, this.bottomSash, this.bottomPanel !== null && this.bottomPanelVisible);
    }

    private renderChild(context: RenderContext, child: TUIElement | null, show: boolean): void {
        if (!child || !show) return;
        const offset = new Offset(child.localPosition.dx, child.localPosition.dy);
        const clip = new Rect(child.globalPosition, child.layoutSize);
        child.render(context.withOffset(offset).withClip(clip));
    }
}
