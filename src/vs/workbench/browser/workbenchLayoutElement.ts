import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { SashElement } from "@tuidom/elements/sash/sashElement";

const DEFAULT_LEFT_WIDTH = 30;
/** Fits the "  EXPLORER" title without clipping. */
const MIN_LEFT_WIDTH = 12;
const MIN_CENTER_WIDTH = 20;

/**
 * Upper bound of the dynamic default: the reference sizes the auxiliary bar with
 * "the side bar dimensions", `min(300, width / 4)` px (`layout.ts`).
 */
const DEFAULT_RIGHT_WIDTH = 30;
const MIN_RIGHT_WIDTH = MIN_LEFT_WIDTH;

const DEFAULT_PANEL_HEIGHT = 12;
/** Fits the tab header + a couple of content rows. */
const MIN_PANEL_HEIGHT = 3;
const MIN_EDITOR_HEIGHT = 3;

/**
 * Аналог эталона — `workbench/browser/layout.ts`. Не хватает ширины — первой
 * сжимается правая панель (у эталона — `LayoutPriority.Low`), затем левая.
 * Клампы — только при раскладке: сохранённые ширины не меняются, и временно
 * узкий терминал их не портит.
 */
export class WorkbenchLayoutElement extends TUIElement {
    private leftPanel: TUIElement | null = null;
    private centerContent: TUIElement | null = null;
    private bottomPanel: TUIElement | null = null;
    private rightPanel: TUIElement | null = null;

    private leftPanelVisible = true;
    private leftPanelWidth = DEFAULT_LEFT_WIDTH;

    private bottomPanelVisible = false;
    private bottomPanelHeight = DEFAULT_PANEL_HEIGHT;

    private rightPanelVisible = false;
    /** `null` — пользователь ширину не задавал: действует динамический дефолт {@link defaultRightWidth}. */
    private rightPanelWidth: number | null = null;

    /** НЕ вызывается из `performLayout`: display-клампы — не действие пользователя. */
    public onDidChangeLayout?: () => void;

    private sash = new SashElement("vertical");
    private rightSash = new SashElement("vertical");
    // Stryker disable next-line StringLiteral: SashElement сверяет ориентацию только с "vertical" — любая другая строка и есть горизонталь, мутант эквивалентен
    private bottomSash = new SashElement("horizontal");

    public constructor() {
        super();
        this.syncChildren();
        this.sash.onDrag = (boundaryScreenX) => {
            this.leftPanelWidth = this.clampWidth(boundaryScreenX - this.globalPosition.x);
            this.markDirty();
            this.onDidChangeLayout?.();
        };
        this.rightSash.onDrag = (boundaryScreenX) => {
            // The sash sits on the right panel's first column, so the boundary column
            // belongs to the panel.
            const containerRight = this.globalPosition.x + this.layoutSize.width;
            this.rightPanelWidth = this.clampRightWidth(containerRight - boundaryScreenX);
            this.markDirty();
            this.onDidChangeLayout?.();
        };
        this.bottomSash.onDrag = (boundaryScreenY) => {
            const containerBottom = this.globalPosition.y + this.layoutSize.height;
            this.bottomPanelHeight = this.clampHeight(containerBottom - boundaryScreenY);
            this.markDirty();
            this.onDidChangeLayout?.();
        };
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

    public setRightPanel(element: TUIElement | null): void {
        this.rightPanel = element;
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

    public setRightPanelVisible(visible: boolean): void {
        this.rightPanelVisible = visible;
        this.syncChildren();
        this.onDidChangeLayout?.();
    }

    public getRightPanelVisible(): boolean {
        return this.rightPanelVisible;
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

    public setRightPanelWidth(width: number | null): void {
        this.rightPanelWidth = width === null ? null : Math.max(MIN_RIGHT_WIDTH, Math.round(width));
        this.onDidChangeLayout?.();
    }

    public getRightPanelWidth(): number | null {
        return this.rightPanelWidth;
    }

    public setBottomPanelHeight(height: number): void {
        this.bottomPanelHeight = Math.max(MIN_PANEL_HEIGHT, Math.round(height));
        this.onDidChangeLayout?.();
    }

    public getBottomPanelHeight(): number {
        return this.bottomPanelHeight;
    }

    public nudgeLeftPanelWidth(delta: number): void {
        this.leftPanelWidth = this.clampWidth(this.leftPanelWidth + delta);
        this.markDirty();
        this.onDidChangeLayout?.();
    }

    public resetLeftPanelWidth(): void {
        this.leftPanelWidth = DEFAULT_LEFT_WIDTH;
        this.markDirty();
        this.onDidChangeLayout?.();
    }

    public nudgeRightPanelWidth(delta: number): void {
        const current = this.rightPanelWidth ?? this.defaultRightWidth(this.layoutSize.width);
        this.rightPanelWidth = this.clampRightWidth(current + delta);
        this.markDirty();
        this.onDidChangeLayout?.();
    }

    public nudgeBottomPanelHeight(delta: number): void {
        this.bottomPanelHeight = this.clampHeight(this.bottomPanelHeight + delta);
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

    public getRightPanel(): TUIElement | null {
        return this.rightPanel;
    }

    /**
     * Скрытая панель ОСТАЁТСЯ в дереве с hidden=true — root и стили доходят.
     * Sashes are added last so they sit on top of the neighbouring content for hit-testing.
     */
    private syncChildren(): void {
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
        if (this.rightPanel !== null) {
            this.rightPanel.hidden = !this.rightPanelVisible;
            children.push(this.rightPanel);
        }
        this.sash.hidden = !this.isLeftShown();
        children.push(this.sash);
        this.rightSash.hidden = !this.isRightShown();
        children.push(this.rightSash);
        this.bottomSash.hidden = !(this.bottomPanel !== null && this.bottomPanelVisible);
        children.push(this.bottomSash);
        this.setChildren(children);
    }

    private isLeftShown(): boolean {
        return this.leftPanel !== null && this.leftPanelVisible;
    }

    private isRightShown(): boolean {
        return this.rightPanel !== null && this.rightPanelVisible;
    }

    private clampWidth(width: number): number {
        return this.clampWidthTo(width, this.layoutSize.width);
    }

    /**
     * Левая панель вправе оттеснить показанную правую до её минимума, но не
     * съесть его — иначе правая пропала бы без команды пользователя.
     */
    private clampWidthTo(width: number, containerWidth: number): number {
        const reserved = this.isRightShown() ? MIN_RIGHT_WIDTH : 0;
        const maxLeft = Math.max(MIN_LEFT_WIDTH, containerWidth - MIN_CENTER_WIDTH - reserved);
        const clamped = Math.max(MIN_LEFT_WIDTH, Math.min(Math.round(width), maxLeft));
        return Math.min(clamped, containerWidth);
    }

    /** Правая растёт только за счёт редактора, показанную левую не теснит. */
    private clampRightWidth(width: number): number {
        const containerWidth = this.layoutSize.width;
        const { left } = this.computeSideWidths(containerWidth);
        const maxRight = Math.max(MIN_RIGHT_WIDTH, containerWidth - MIN_CENTER_WIDTH - left);
        const clamped = Math.max(MIN_RIGHT_WIDTH, Math.min(Math.round(width), maxRight));
        return Math.min(clamped, containerWidth);
    }

    private defaultRightWidth(containerWidth: number): number {
        return Math.max(MIN_RIGHT_WIDTH, Math.min(DEFAULT_RIGHT_WIDTH, Math.floor(containerWidth / 4)));
    }

    /** Не хватает и минимумов (вырожденно узкий терминал) — панели хотя бы не вылезают за контейнер. */
    private computeSideWidths(containerWidth: number): { left: number; right: number } {
        const showLeft = this.isLeftShown();
        const showRight = this.isRightShown();
        let left = showLeft ? Math.max(MIN_LEFT_WIDTH, this.leftPanelWidth) : 0;
        let right = showRight ? (this.rightPanelWidth ?? this.defaultRightWidth(containerWidth)) : 0;
        const budget = Math.max(0, containerWidth - MIN_CENTER_WIDTH);
        // Stryker disable EqualityOperator: на равенстве ужатие — тождество (ширины уже не меньше минимумов), `>=` эквивалентно `>`
        if (showRight && left + right > budget) right = Math.max(MIN_RIGHT_WIDTH, budget - left);
        if (showLeft && left + right > budget) left = Math.max(MIN_LEFT_WIDTH, budget - right);
        if (left + right > containerWidth) right = Math.max(0, containerWidth - left);
        // Stryker restore EqualityOperator
        return { left: Math.min(left, containerWidth), right };
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

        const showBottom = this.bottomPanel !== null && this.bottomPanelVisible;
        // Display-only clamps — do NOT mutate the stored width/height: a temporary shrink is not permanent.
        const { left: leftWidth, right: rightWidth } = this.computeSideWidths(containerSize.width);
        const centerWidth = Math.max(0, containerSize.width - leftWidth - rightWidth);
        const panelHeight = showBottom ? this.clampHeightTo(this.bottomPanelHeight, containerSize.height) : 0;
        const centerHeight = Math.max(0, containerSize.height - panelHeight);

        if (this.isLeftShown() && this.leftPanel) {
            this.layoutChild(this.leftPanel, 0, 0, BoxConstraints.tight(new Size(leftWidth, containerSize.height)));
        }

        if (this.centerContent) {
            this.layoutChild(
                this.centerContent,
                leftWidth,
                0,
                BoxConstraints.tight(new Size(centerWidth, centerHeight)),
            );
        }

        if (showBottom && this.bottomPanel) {
            this.layoutChild(
                this.bottomPanel,
                leftWidth,
                centerHeight,
                BoxConstraints.tight(new Size(centerWidth, panelHeight)),
            );
        }

        if (this.isRightShown() && this.rightPanel) {
            const rightX = leftWidth + centerWidth;
            this.layoutChild(
                this.rightPanel,
                rightX,
                0,
                BoxConstraints.tight(new Size(rightWidth, containerSize.height)),
            );
            // 1-column hit target on the right panel's first column — not on the
            // editor's last one, where the editor's scrollbar lives.
            this.layoutChild(
                this.rightSash,
                rightX,
                0,
                BoxConstraints.tight(new Size(Math.min(1, rightWidth), containerSize.height)),
            );
        }

        if (this.isLeftShown()) {
            // Must be laid out explicitly, otherwise its lazy layoutSize would report a
            // stale box at (0,0) and break hit-testing.
            this.layoutChild(this.sash, leftWidth, 0, BoxConstraints.tight(new Size(1, containerSize.height)));
        }

        if (showBottom) {
            this.layoutChild(this.bottomSash, leftWidth, centerHeight, BoxConstraints.tight(new Size(centerWidth, 1)));
        }

        return containerSize;
    }
}
