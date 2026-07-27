import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";
import { OverlayLayer } from "../contextview/overlayLayer.ts";
import type { MenuBarElement } from "../menu/menuBarElement.ts";
import type { StatusBarElement } from "../statusbar/statusBarElement.ts";

export class BodyElement extends TUIElement {
    public title = "";
    public content: TUIElement | null = null;
    public menuBar: MenuBarElement | null = null;
    public statusBar: StatusBarElement | null = null;
    public readonly overlayLayer: OverlayLayer;

    public constructor() {
        super();
        // BodyElement is the root, so mark it as such
        this.setAsRoot();

        this.overlayLayer = new OverlayLayer();
        this.syncChildren();
    }

    public override getOverlayLayer(): OverlayLayer {
        return this.overlayLayer;
    }

    public setContent(element: TUIElement): void {
        this.content = element;
        this.syncChildren();
    }

    public setMenuBar(menuBar: MenuBarElement | null): void {
        this.menuBar = menuBar;
        this.syncChildren();
    }

    public setStatusBar(statusBar: StatusBarElement): void {
        this.statusBar = statusBar;
        this.syncChildren();
    }

    /**
     * Пересобирает список детей в каноническом порядке слотов. Порядок — это
     * z-порядок хит-теста: overlay последний, т.е. поверх всего.
     */
    private syncChildren(): void {
        const children: TUIElement[] = [];
        if (this.menuBar) children.push(this.menuBar);
        if (this.content) children.push(this.content);
        if (this.statusBar) children.push(this.statusBar);
        children.push(this.overlayLayer);
        this.setChildren(children);
    }

    public performLayout(constraints: BoxConstraints): Size {
        const containerSize = super.performLayout(constraints);
        const menuBarHeight = this.menuBar ? 1 : 0;
        const statusBarHeight = this.statusBar ? 1 : 0;

        if (this.menuBar) {
            this.layoutChild(this.menuBar, 0, 0, BoxConstraints.tight(containerSize));
        }

        if (this.content) {
            const contentHeight = Math.max(0, containerSize.height - menuBarHeight - statusBarHeight);
            const contentSize = new Size(containerSize.width, contentHeight);
            this.layoutChild(this.content, 0, menuBarHeight, BoxConstraints.tight(contentSize));
        }

        if (this.statusBar) {
            const statusBarY = containerSize.height - statusBarHeight;
            this.layoutChild(this.statusBar, 0, statusBarY, BoxConstraints.tight(new Size(containerSize.width, statusBarHeight)));
        }

        this.layoutChild(this.overlayLayer, 0, 0, BoxConstraints.tight(containerSize));

        return containerSize;
    }

    public render(context: RenderContext) {
        // Title (legacy behaviour)
        for (let y = 0; y < this.title.length; y++) {
            context.setCell(y, 0, { char: this.title[y] });
        }

        // Дети в каноническом порядке слотов (см. syncChildren): menuBar,
        // content, statusBar, overlay поверх всех.
        this.renderChildren(context);
    }
}
