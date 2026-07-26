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
        this.overlayLayer.setParent(this);
    }

    public override getOverlayLayer(): OverlayLayer {
        return this.overlayLayer;
    }

    public setContent(element: TUIElement): void {
        this.content = element;
        this.content.setParent(this);
    }

    public setMenuBar(menuBar: MenuBarElement): void {
        this.menuBar = menuBar;
        this.menuBar.setParent(this);
    }

    public setStatusBar(statusBar: StatusBarElement): void {
        this.statusBar = statusBar;
        this.statusBar.setParent(this);
    }

    public override getChildren(): readonly TUIElement[] {
        const children: TUIElement[] = [];
        if (this.menuBar) children.push(this.menuBar);
        if (this.content) children.push(this.content);
        if (this.statusBar) children.push(this.statusBar);
        children.push(this.overlayLayer);
        return children;
    }

    public performLayout(constraints: BoxConstraints): Size {
        const containerSize = super.performLayout(constraints);
        const menuBarHeight = this.menuBar ? 1 : 0;
        const statusBarHeight = this.statusBar ? 1 : 0;

        if (this.menuBar) {
            this.menuBar.localPosition = new Offset(0, 0);
            this.menuBar.globalPosition = new Point(this.globalPosition.x, this.globalPosition.y);
            this.menuBar.performLayout(BoxConstraints.tight(containerSize));
        }

        if (this.content) {
            const contentHeight = Math.max(0, containerSize.height - menuBarHeight - statusBarHeight);
            const contentSize = new Size(containerSize.width, contentHeight);
            this.content.localPosition = new Offset(0, menuBarHeight);
            this.content.globalPosition = new Point(this.globalPosition.x, this.globalPosition.y + menuBarHeight);
            this.content.performLayout(BoxConstraints.tight(contentSize));
        }

        if (this.statusBar) {
            const statusBarY = containerSize.height - statusBarHeight;
            this.statusBar.localPosition = new Offset(0, statusBarY);
            this.statusBar.globalPosition = new Point(this.globalPosition.x, this.globalPosition.y + statusBarY);
            this.statusBar.performLayout(BoxConstraints.tight(new Size(containerSize.width, statusBarHeight)));
        }

        this.overlayLayer.localPosition = new Offset(0, 0);
        this.overlayLayer.globalPosition = new Point(this.globalPosition.x, this.globalPosition.y);
        this.overlayLayer.performLayout(BoxConstraints.tight(containerSize));

        return containerSize;
    }

    public render(context: RenderContext) {
        // Title (legacy behaviour)
        for (let y = 0; y < this.title.length; y++) {
            context.setCell(y, 0, { char: this.title[y] });
        }

        // Content layer
        if (this.content) {
            const contentOffset = new Offset(this.content.localPosition.dx, this.content.localPosition.dy);
            const contentClip = new Rect(this.content.globalPosition, this.content.layoutSize);
            this.content.render(context.withOffset(contentOffset).withClip(contentClip));
        }

        // Status bar
        if (this.statusBar) {
            const statusBarOffset = new Offset(this.statusBar.localPosition.dx, this.statusBar.localPosition.dy);
            const statusBarClip = new Rect(this.statusBar.globalPosition, this.statusBar.layoutSize);
            this.statusBar.render(context.withOffset(statusBarOffset).withClip(statusBarClip));
        }

        // Menu bar — rendered after content so popup overlays content
        if (this.menuBar) {
            const menuBarOffset = new Offset(this.menuBar.localPosition.dx, this.menuBar.localPosition.dy);
            this.menuBar.render(context.withOffset(menuBarOffset));
        }

        // Context menu layer — rendered on top
        this.overlayLayer.render(context);
    }
}
